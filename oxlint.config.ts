import { createStrictConfig } from "./config/oxlint-strict.js";

export default createStrictConfig({
    ignorePatterns: ["dist/**", "site/dist/**", "config/**"],
    rules: {
        "no-console": "error",
    },
    overrides: [{ files: ["scripts/**", "site/**"], rules: { "no-console": "off" } }],
});
