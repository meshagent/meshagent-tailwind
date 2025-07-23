const esbuild = require("esbuild");
const alias      = require("esbuild-plugin-alias");
const path       = require("path");

const options = {
    entryPoints: ["src/**/*.ts", "src/**/*.tsx"],
    outbase: "src",
    bundle: false,
    platform: "neutral",
    loader: {
        '.ts': 'ts',
        '.tsx': 'tsx',
        '.css': 'css',
    },
    resolveExtensions: [ '.tsx', '.ts', '.js', '.jsx', '.json' ],
    tsconfig: "tsconfig.json",
    plugins: [
        alias({
            "@": path.resolve(__dirname, "src"),
        }),
    ],
};

Promise.all([
    esbuild.build({
        ...options,
        outdir: "dist/esm",
        format: "esm",
    }),
    esbuild.build({
        ...options,
        outdir: "dist/cjs",
        format: "cjs",
    }),
]).catch((err) => console.error(err));
