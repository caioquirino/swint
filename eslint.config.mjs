import nx from "@nx/eslint-plugin";

export default [
    ...nx.configs["flat/base"],
    ...nx.configs["flat/typescript"],
    ...nx.configs["flat/javascript"],
    {
      "ignores": [
        "**/dist",
        "**/out-tsc",
        "**/vitest.config.*.timestamp*"
      ]
    },
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.js",
            "**/*.jsx"
        ],
        rules: {
            "@nx/enforce-module-boundaries": [
                "error",
                {
                    enforceBuildableLibDependency: true,
                    allow: [
                        "^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$"
                    ],
                    depConstraints: [
                        { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },
                        { sourceTag: 'scope:web', onlyDependOnLibsWithTags: ['scope:web', 'scope:shared'] },
                        { sourceTag: 'scope:api', onlyDependOnLibsWithTags: ['scope:api', 'scope:shared'] },
                        { sourceTag: 'type:contract', onlyDependOnLibsWithTags: ['type:contract', 'type:util'] },
                        { sourceTag: 'type:util', onlyDependOnLibsWithTags: ['type:contract', 'type:util'] },
                        { sourceTag: 'type:ui', onlyDependOnLibsWithTags: ['type:ui', 'type:contract', 'type:util'] },
                        { sourceTag: 'type:data-access', onlyDependOnLibsWithTags: ['type:data-access', 'type:contract', 'type:util'] },
                        { sourceTag: 'type:feature', onlyDependOnLibsWithTags: ['type:feature', 'type:ui', 'type:data-access', 'type:contract', 'type:util'] },
                    ]
                }
            ]
        }
    },
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.cts",
            "**/*.mts",
            "**/*.js",
            "**/*.jsx",
            "**/*.cjs",
            "**/*.mjs"
        ],
        // Override or add rules here
        rules: {}
    }
];
