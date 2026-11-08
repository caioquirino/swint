import nx from "@nx/eslint-plugin";
import baseConfig from "../../../eslint.config.mjs";

export default [
    ...nx.configs["flat/react"],
    ...baseConfig,
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.js",
            "**/*.jsx"
        ],
        // Override or add rules here
        rules: {}
    },
    {
        files: ["**/*.json"],
        rules: {
            "@nx/dependency-checks": [
                "error",
                {
                    buildTargets: ["typecheck"],
                    ignoredDependencies: ["vitest", "@testing-library/react", "@testing-library/jest-dom", "@testing-library/user-event"],
                    ignoredFiles: [
                        "{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}",
                        "{projectRoot}/vite.config.{js,ts,mjs,mts}",
                        "{projectRoot}/src/test-setup.ts",
                        "{projectRoot}/src/testing/**"
                    ]
                }
            ]
        },
        languageOptions: { parser: await import("jsonc-eslint-parser") }
    },
    {
        ignores: [
            "**/out-tsc"
        ]
    }
];
