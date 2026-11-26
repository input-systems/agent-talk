import type { OxlintConfig } from "oxlint";

export declare const createStrictConfig: (options?: {
    ignorePatterns?: string[];
    rules?: OxlintConfig["rules"];
    overrides?: OxlintConfig["overrides"];
    env?: OxlintConfig["env"];
}) => OxlintConfig;
