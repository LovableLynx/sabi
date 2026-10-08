export const STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
  "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT Abuja", "Gombe",
  "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos",
  "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
  "Taraba", "Yobe", "Zamfara",
];

// Exam tracks. WAEC/JAMB is the benchmarked, fine-tuned core; BECE and
// Common Entrance are smaller pilot tracks for younger learners.
export const TRACKS = {
  waec: { label: "SS · WAEC/JAMB", short: "WAEC/JAMB", pilot: false },
  bece: { label: "JSS · BECE", short: "BECE", pilot: true },
  ncee: { label: "Primary · Common Entrance", short: "Common Entrance", pilot: true },
};

export const SUBJECTS = {
  literature: { track: "waec", label: "Literature", stream: "Arts", emoji: "📜", color: "#7b4fd6" },
  physics: { track: "waec", label: "Physics", stream: "Science", emoji: "⚡", color: "#1f7ae0" },
  accounting: { track: "waec", label: "Accounting", stream: "Commercial", emoji: "📒", color: "#e08a1f" },
  "bece-english": { track: "bece", label: "English Studies", stream: "→ Literature", emoji: "✍️", color: "#8d5bd8" },
  "bece-science": { track: "bece", label: "Basic Science", stream: "→ Physics", emoji: "🔬", color: "#2a86d9" },
  "bece-business": { track: "bece", label: "Business Studies", stream: "→ Accounting", emoji: "💼", color: "#d9821f" },
  "ncee-maths": { track: "ncee", label: "Mathematics", stream: "Primary", emoji: "➗", color: "#0f9d76" },
  "ncee-english": { track: "ncee", label: "English", stream: "Primary", emoji: "🔤", color: "#c2410c" },
  "ncee-science": { track: "ncee", label: "Basic Science", stream: "Primary", emoji: "🌱", color: "#4d7c0f" },
};

export const AVATARS = ["🐢", "🦁", "🦅", "🐘", "🦒", "🐆", "🦜", "🐊"];
