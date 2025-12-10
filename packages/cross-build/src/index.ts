/**
 * @napi-rs/cross-build
 *
 * Cross-compile Rust projects without Docker
 *
 * @example
 * ```ts
 * import { build, getCrossCompileEnv } from '@napi-rs/cross-build'
 *
 * // Cross-compile for Linux ARM64
 * const result = await build({
 *   target: 'aarch64-unknown-linux-gnu',
 *   release: true,
 *   useNapiCross: true,
 * })
 *
 * // Or just get the environment variables needed
 * const env = getCrossCompileEnv({
 *   target: 'aarch64-unknown-linux-gnu',
 *   useNapiCross: true,
 * })
 * ```
 */

export {
  build,
  getCrossCompileEnv,
  type CrossBuildOptions,
  type CrossBuildResult,
} from './build.js'

export {
  parseTriple,
  getSystemDefaultTarget,
  getTargetLinker,
  targetToEnvVar,
  TARGET_LINKER,
  type Target,
  type Platform,
} from './target.js'

export { tryInstallCargoBinary } from './cargo.js'

export { debugFactory, debug } from './log.js'
