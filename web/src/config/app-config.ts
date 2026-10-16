import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "Paper Desk",
  version: packageJson.version,
  copyright: `© ${currentYear}, Paper Desk.`,
  meta: {
    title: "Paper Desk: a second opinion for AI trading strategies",
    description: "Test an AI trading strategy in safe sandboxes and get one grade with plain reasons. Practice only. Not financial advice.",
  },
};
