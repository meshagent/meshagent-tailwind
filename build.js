const esbuild = require("esbuild");

const define = {
    "process.env.MESHAGENT_SECRET": JSON.stringify(process.env.MESHAGENT_SECRET),
    "process.env.MESHAGENT_PROJECT_ID": JSON.stringify(process.env.MESHAGENT_PROJECT_ID),
    "process.env.MESHAGENT_KEY_ID": JSON.stringify(process.env.MESHAGENT_KEY_ID),
    "process.env.MESHAGENT_API_URL": JSON.stringify(process.env.MESHAGENT_API_URL),
};

const options = {
    entryPoints: ["src/**/*.ts", "src/**/*.tsx"],
    //entryPoints: ["src/index.ts"],
    outbase: "src",
    bundle: false,
    platform: "neutral",
    loader: {
        '.ts': 'ts',
        '.tsx': 'tsx',
        '.css': 'css',
    },
//    outExtension: {
//         '.ts': '.js',
//         '.tsx': '.js',
//    },
    resolveExtensions: [ '.tsx', '.ts', '.js', '.jsx', '.json' ],
    tsconfig: "tsconfig.json",
    define,
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
