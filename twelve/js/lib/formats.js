// The game formats, as the app presents them.
export const FORMATS = {
  trivia: { name: "Trivia", emoji: "🧠", blurb: "Ten holiday trivia questions." },
  bingo: { name: "Bingo", emoji: "🎯", blurb: "Mark real-life holiday moments as they happen." },
  emoji: { name: "Emoji Decode", emoji: "🤔", blurb: "Guess the movie or song from emoji." },
  two_truths: { name: "Two Truths and a Tradition", emoji: "🌍", blurb: "Spot the made-up holiday tradition." },
  photo: { name: "Photo Challenge", emoji: "📸", blurb: "One photo, one prompt. The host picks the winner." },
  lyrics: { name: "Lyric Fill-in-the-Blank", emoji: "🎶", blurb: "Finish the carol lyric." },
  wyr: { name: "Would You Rather", emoji: "⚖️", blurb: "Pick a side, then see how the group split." },
  speed_match: { name: "Speed-Matching", emoji: "⚡", blurb: "Match them up against the clock." },
  scavenger: { name: "Scavenger Hunt", emoji: "🔦", blurb: "Find things around the house, snap proof, beat the clock." },
  finale: { name: "Finale Quiz", emoji: "👑", blurb: "Questions pulled from the whole month." },
};

export const REPEATABLE = ["trivia", "bingo", "emoji", "two_truths", "photo", "lyrics", "wyr", "speed_match", "scavenger"];

export const formatName = (key) => FORMATS[key]?.name || key;
export const formatEmoji = (key) => FORMATS[key]?.emoji || "🎄";
