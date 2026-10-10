// Where the always-on Sabi services live (Modal, see ml/modal/sabi_modal.py).
// Leave empty to run with no server (offline guided hints, on-device board).
//   AI_URL   GPU tutor: only chat messages go here, so the GPU wakes only
//            when a student actually asks Sabi something.
//   API_URL  cheap CPU service: leaderboard, pilot feedback, status checks.
export const AI_URL = "";
export const API_URL = "";
