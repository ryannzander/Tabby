/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  /**
   * The workspace packages ship TypeScript source rather than a build, so Next has to compile them
   * the same way it compiles this app.
   */
  transpilePackages: ["@tappy/protocol", "@tappy/contracts"],

  /**
   * `@tappy/protocol` imports its own modules as `./types.js`, which is correct for Node's ESM
   * resolution and is what tsc and vitest expect. Webpack takes the specifier literally, looks for
   * a `.js` file that does not exist, and fails the build. Turbopack resolves it, which is why
   * `next dev --turbo` works and `next build` did not.
   */
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return webpackConfig;
  },
};

export default config;
