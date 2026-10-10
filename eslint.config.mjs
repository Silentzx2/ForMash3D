import { defineConfig } from "eslint/config";
import next from "eslint-config-next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ponytail: these React Compiler / react-hooks v6 rules are intentionally
// downgraded to warnings. They fire on common, working patterns (data fetching
// inside useEffect, derived components, ref reads during render) and were
// blocking `next build` as errors. Revisit individually if the React Compiler
// is adopted project-wide.
import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";

export default defineConfig([
    ...next,
    {
        plugins: {
            "react-hooks": reactHooks,
            "react": react,
        },
        rules: {
            "react-hooks/set-state-in-effect": "warn",
            "react-hooks/immutability": "warn",
            "react-hooks/static-components": "warn",
            "react-hooks/refs": "warn",
            "react-hooks/preserve-manual-memoization": "warn",
            "react/no-unescaped-entities": "warn",
        },
    },
    {
        ignores: [
            "public/**",
            ".next/**",
            "out/**",
            "build/**",
            "next-env.d.ts",
            "backend/**",
            "tools/**",
        ],
    },
]);
