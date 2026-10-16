// App-wide state: the signed-in person, their profile and groups, and the
// group currently open. Plus a tiny hash router.
import { createContext, useContext, useEffect, useState, useCallback } from "../vendor/preact-htm.mjs";
import { sb, q, rpc, currentSeason, storage } from "./db.js";

export const AppContext = createContext(null);
export const GroupContext = createContext(null);
export const useApp = () => useContext(AppContext);
export const useGroup = () => useContext(GroupContext);

// ---------- Router ----------

function readHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  // Supabase puts sign-in tokens in the hash; they aren't routes.
  if (/access_token=|error_description=|type=magiclink/.test(raw)) return [];
  return raw.split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
}

export function useRoute() {
  const [parts, setParts] = useState(readHash);
  useEffect(() => {
    const onChange = () => {
      setParts(readHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return parts;
}

export function go(path) {
  const next = "#" + path;
  if (location.hash === next) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = next;
}

// ---------- Signed-in person ----------

export function useAppState() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(undefined);
  const [groups, setGroups] = useState(undefined);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => setSession(s ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id;

  const refreshProfile = useCallback(async () => {
    if (!userId) return setProfile(null);
    const row = await q(sb.from("twelve_profiles").select("*").eq("id", userId).maybeSingle());
    setProfile(row ?? null);
    return row;
  }, [userId]);

  const refreshGroups = useCallback(async () => {
    if (!userId) return setGroups([]);
    const rows = await q(
      sb.from("twelve_members").select("joined_at, group:twelve_groups(*)").eq("user_id", userId).order("joined_at")
    );
    const list = rows.map((r) => r.group).filter(Boolean);
    setGroups(list);
    return list;
  }, [userId]);

  useEffect(() => {
    if (session === undefined) return;
    if (!userId) {
      setProfile(null);
      setGroups([]);
      return;
    }
    setProfile(undefined);
    setGroups(undefined);
    refreshProfile().catch(() => setProfile(null));
    refreshGroups().catch(() => setGroups([]));
  }, [userId]);

  return {
    session,
    user: session?.user ?? null,
    profile,
    groups,
    refreshProfile,
    refreshGroups,
    loading: session === undefined || (userId && (profile === undefined || groups === undefined)),
  };
}

// ---------- One group ----------

export function useGroupState(groupId) {
  const { user } = useApp();
  const [state, setState] = useState({ loading: true });

  const load = useCallback(async () => {
    try {
      const season = currentSeason();
      const [group, members, giftSeason, participants, couples, match, questionnaire] = await Promise.all([
        q(sb.from("twelve_groups").select("*").eq("id", groupId).maybeSingle()),
        q(sb.from("twelve_members").select("user_id, joined_at").eq("group_id", groupId).order("joined_at")),
        q(sb.from("twelve_gift_seasons").select("*").eq("group_id", groupId).eq("season", season).maybeSingle()),
        q(sb.from("twelve_gift_participants").select("user_id").eq("group_id", groupId).eq("season", season)),
        q(sb.from("twelve_couples").select("user_a, user_b").eq("group_id", groupId)),
        q(sb.from("twelve_matches").select("*").eq("group_id", groupId).eq("season", season).eq("giver_id", user.id).maybeSingle()),
        q(sb.from("twelve_questionnaires").select("*").eq("group_id", groupId).eq("season", season).eq("user_id", user.id).maybeSingle()),
      ]);
      if (!group) {
        setState({ loading: false, missing: true });
        return;
      }
      const ids = members.map((m) => m.user_id);
      const profiles = ids.length ? await q(sb.from("twelve_profiles").select("*").in("id", ids)) : [];
      const byId = Object.fromEntries(profiles.map((p) => [p.id, p]));
      let schedule = null;
      if (group.games_enabled) schedule = await rpc("twelve_schedule", { p_group: groupId });
      storage.set("lastGroup", groupId);
      setState({
        loading: false,
        group,
        members: members.map((m) => ({ ...m, profile: byId[m.user_id] || { id: m.user_id, display_name: "Someone" } })),
        profiles: byId,
        isHost: group.host_id === user.id,
        gift: {
          season: giftSeason,
          participants: participants.map((p) => p.user_id),
          couples,
          match,
          questionnaire,
        },
        schedule,
      });
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error }));
    }
  }, [groupId, user?.id]);

  useEffect(() => {
    setState({ loading: true });
    load();
  }, [load]);

  // Refresh when the app comes back to the foreground (a day may have
  // unlocked, names may have been drawn).
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  return { ...state, reload: load, groupId };
}

export function nameOf(group, userId) {
  return group?.profiles?.[userId]?.display_name || "Someone";
}

// Which game day matters right now: the open one, else the next to unlock,
// else the last one.
export function currentDay(schedule, now = Date.now()) {
  const days = schedule?.days || [];
  if (!days.length) return null;
  const open = days.find((d) => new Date(d.unlocks_at) <= now && now < new Date(d.closes_at));
  if (open) return { ...open, state: "open" };
  const next = days.find((d) => new Date(d.unlocks_at) > now);
  if (next) return { ...next, state: "locked" };
  return { ...days[days.length - 1], state: "closed" };
}

export function dayState(day, now = Date.now()) {
  if (now < new Date(day.unlocks_at)) return "locked";
  if (now < new Date(day.closes_at)) return "open";
  return "closed";
}
