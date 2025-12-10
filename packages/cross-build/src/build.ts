import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

import * as colors from 'colorette'

import { tryInstallCargoBinary } from './cargo.js'
import { debugFactory } from './log.js'
import {
  type Target,
  getTargetLinker,
  parseTriple,
  targetToEnvVar,
  getSystemDefaultTarget,
} from './target.js'

const debug = debugFactory('build')
const require = createRequire(import.meta.url)

/**
 * Options for cross-compiling Rust projects
 */
export interface CrossBuildOptions {
  /**
   * The target triple to build for (e.g., 'aarch64-unknown-linux-gnu')
   */
  target?: string
  /**
   * Working directory for the build
   */
  cwd?: string
  /**
   * Path to Cargo.toml manifest file
   */
  manifestPath?: string
  /**
   * Directory for build artifacts
   */
  targetDir?: string
  /**
   * Build in release mode
   */
  release?: boolean
  /**
   * Show verbose output
   */
  verbose?: boolean
  /**
   * Build profile (e.g., 'release', 'dev')
   */
  profile?: string
  /**
   * Use @napi-rs/cross-toolchain for Linux cross-compilation
   */
  useNapiCross?: boolean
  /**
   * Use cargo-zigbuild/cargo-xwin for cross-compilation
   */
  crossCompile?: boolean
  /**
   * Use cross-rs instead of cargo
   */
  useCross?: boolean
  /**
   * Strip debug symbols
   */
  strip?: boolean
  /**
   * Package name in workspace
   */
  package?: string
  /**
   * Binary name to build
   */
  bin?: string
  /**
   * Features to enable
   */
  features?: string[]
  /**
   * Enable all features
   */
  allFeatures?: boolean
  /**
   * Disable default features
   */
  noDefaultFeatures?: boolean
  /**
   * Additional cargo arguments
   */
  cargoArgs?: string[]
  /**
   * Additional environment variables
   */
  env?: Record<string, string>
}

/**
 * Result of the cross-build operation
 */
export interface CrossBuildResult {
  /**
   * Whether the build succeeded
   */
  success: boolean
  /**
   * The target that was built
   */
  target: Target
  /**
   * Environment variables that were set
   */
  envs: Record<string, string>
}

/**
 * Cross-compile a Rust project
 *
 * @example
 * ```ts
 * import { build } from '@napi-rs/cross-build'
 *
 * const result = await build({
 *   target: 'aarch64-unknown-linux-gnu',
 *   release: true,
 *   useNapiCross: true,
 * })
 * ```
 */
export async function build(
  options: CrossBuildOptions = {},
): Promise<CrossBuildResult> {
  const builder = new CrossBuilder(options)
  return builder.build()
}

/**
 * Get environment variables needed for cross-compilation without actually building
 *
 * @example
 * ```ts
 * import { getCrossCompileEnv } from '@napi-rs/cross-build'
 *
 * const env = getCrossCompileEnv({
 *   target: 'aarch64-unknown-linux-gnu',
 *   useNapiCross: true,
 * })
 * console.log(env)
 * ```
 */
export function getCrossCompileEnv(
  options: CrossBuildOptions = {},
): Record<string, string> {
  const builder = new CrossBuilder(options)
  return builder.getEnvs()
}

class CrossBuilder {
  private readonly args: string[] = []
  private readonly envs: Record<string, string> = {}
  private readonly target: Target
  private readonly cwd: string

  constructor(private readonly options: CrossBuildOptions) {
    this.target = options.target
      ? parseTriple(options.target)
      : process.env.CARGO_BUILD_TARGET
        ? parseTriple(process.env.CARGO_BUILD_TARGET)
        : getSystemDefaultTarget()
    this.cwd = options.cwd ?? process.cwd()
  }

  getEnvs(): Record<string, string> {
    this.pickCrossToolchain()
    this.setEnvs()
    return { ...this.envs }
  }

  async build(): Promise<CrossBuildResult> {
    this.pickBinary()
      .setPackage()
      .setFeatures()
      .setTarget()
      .pickCrossToolchain()
      .setEnvs()
      .setBypassArgs()

    return this.exec()
  }

  private pickCrossToolchain() {
    if (!this.options.useNapiCross) {
      return this
    }
    if (this.options.useCross) {
      debug.warn(
        'You are trying to use both `useCross` and `useNapiCross` options, `useCross` will be ignored.',
      )
    }

    if (this.options.crossCompile) {
      debug.warn(
        'You are trying to use both `crossCompile` and `useNapiCross` options, `crossCompile` will be ignored.',
      )
    }

    try {
      const { version, download } = require('@napi-rs/cross-toolchain')

      const alias: Record<string, string> = {
        's390x-unknown-linux-gnu': 's390x-ibm-linux-gnu',
      }

      const toolchainPath = join(
        homedir(),
        '.napi-rs',
        'cross-toolchain',
        version,
        this.target.triple,
      )
      mkdirSync(toolchainPath, { recursive: true })
      if (existsSync(join(toolchainPath, 'package.json'))) {
        debug(`Toolchain ${toolchainPath} exists, skip extracting`)
      } else {
        const tarArchive = download(process.arch, this.target.triple)
        tarArchive.unpack(toolchainPath)
      }
      const upperCaseTarget = targetToEnvVar(this.target.triple)
      const crossTargetName = alias[this.target.triple] ?? this.target.triple
      const linkerEnv = `CARGO_TARGET_${upperCaseTarget}_LINKER`
      this.setEnvIfNotExists(
        linkerEnv,
        join(toolchainPath, 'bin', `${crossTargetName}-gcc`),
      )
      this.setEnvIfNotExists(
        'TARGET_SYSROOT',
        join(toolchainPath, crossTargetName, 'sysroot'),
      )
      this.setEnvIfNotExists(
        'TARGET_AR',
        join(toolchainPath, 'bin', `${crossTargetName}-ar`),
      )
      this.setEnvIfNotExists(
        'TARGET_RANLIB',
        join(toolchainPath, 'bin', `${crossTargetName}-ranlib`),
      )
      this.setEnvIfNotExists(
        'TARGET_READELF',
        join(toolchainPath, 'bin', `${crossTargetName}-readelf`),
      )
      this.setEnvIfNotExists(
        'TARGET_C_INCLUDE_PATH',
        join(toolchainPath, crossTargetName, 'sysroot', 'usr', 'include/'),
      )
      this.setEnvIfNotExists(
        'TARGET_CC',
        join(toolchainPath, 'bin', `${crossTargetName}-gcc`),
      )
      this.setEnvIfNotExists(
        'TARGET_CXX',
        join(toolchainPath, 'bin', `${crossTargetName}-g++`),
      )
      this.setEnvIfNotExists(
        'BINDGEN_EXTRA_CLANG_ARGS',
        `--sysroot=${this.envs.TARGET_SYSROOT}`,
      )

      if (
        process.env.TARGET_CC?.startsWith('clang') ||
        (process.env.CC?.startsWith('clang') && !process.env.TARGET_CC)
      ) {
        const TARGET_CFLAGS = process.env.TARGET_CFLAGS ?? ''
        this.envs.TARGET_CFLAGS = `--sysroot=${this.envs.TARGET_SYSROOT} --gcc-toolchain=${toolchainPath} ${TARGET_CFLAGS}`
      }
      if (
        (process.env.CXX?.startsWith('clang++') && !process.env.TARGET_CXX) ||
        process.env.TARGET_CXX?.startsWith('clang++')
      ) {
        const TARGET_CXXFLAGS = process.env.TARGET_CXXFLAGS ?? ''
        this.envs.TARGET_CXXFLAGS = `--sysroot=${this.envs.TARGET_SYSROOT} --gcc-toolchain=${toolchainPath} ${TARGET_CXXFLAGS}`
      }
      this.envs.PATH = this.envs.PATH
        ? `${toolchainPath}/bin:${this.envs.PATH}:${process.env.PATH}`
        : `${toolchainPath}/bin:${process.env.PATH}`
    } catch (e) {
      debug.warn('Pick cross toolchain failed', e as Error)
      // ignore, do nothing
    }
    return this
  }

  private pickBinary() {
    if (this.options.crossCompile) {
      if (this.target.platform === 'win32') {
        if (process.platform === 'win32') {
          debug.warn(
            'You are trying to cross compile to win32 platform on win32 platform which is unnecessary.',
          )
        } else {
          // use cargo-xwin to cross compile to win32 platform
          debug('Use %i', 'cargo-xwin')
          tryInstallCargoBinary('cargo-xwin', 'xwin')
          this.args.push('xwin', 'build')
          if (this.target.arch === 'ia32') {
            this.envs.XWIN_ARCH = 'x86'
          }
          return this
        }
      } else {
        if (
          this.target.platform === 'linux' &&
          process.platform === 'linux' &&
          this.target.arch === process.arch &&
          (function (abi: string | null) {
            const glibcVersionRuntime =
              // @ts-expect-error
              process.report?.getReport()?.header?.glibcVersionRuntime
            const libc = glibcVersionRuntime ? 'gnu' : 'musl'
            return abi === libc
          })(this.target.abi)
        ) {
          debug.warn(
            'You are trying to cross compile to linux target on linux platform which is unnecessary.',
          )
        } else if (
          this.target.platform === 'darwin' &&
          process.platform === 'darwin'
        ) {
          debug.warn(
            'You are trying to cross compile to darwin target on darwin platform which is unnecessary.',
          )
        } else {
          // use cargo-zigbuild to cross compile to other platforms
          debug('Use %i', 'cargo-zigbuild')
          tryInstallCargoBinary('cargo-zigbuild', 'zigbuild')
          this.args.push('zigbuild')
          return this
        }
      }
    }

    this.args.push('build')
    return this
  }

  private setPackage() {
    const args = []

    if (this.options.package) {
      args.push('--package', this.options.package)
    }

    if (this.options.bin) {
      args.push('--bin', this.options.bin)
    }

    if (args.length) {
      debug('Set package flags: ')
      debug('  %O', args)
      this.args.push(...args)
    }

    return this
  }

  private setTarget() {
    debug('Set compiling target to: ')
    debug('  %i', this.target.triple)

    this.args.push('--target', this.target.triple)

    return this
  }

  private setEnvs() {
    // RUSTFLAGS
    let rustflags =
      process.env.RUSTFLAGS ?? process.env.CARGO_BUILD_RUSTFLAGS ?? ''

    if (
      this.target.abi?.includes('musl') &&
      !rustflags.includes('target-feature=-crt-static')
    ) {
      rustflags += ' -C target-feature=-crt-static'
    }

    if (this.options.strip && !rustflags.includes('link-arg=-s')) {
      rustflags += ' -C link-arg=-s'
    }

    if (rustflags.length) {
      this.envs.RUSTFLAGS = rustflags
    }
    // END RUSTFLAGS

    // LINKER
    const linker = this.options.crossCompile
      ? void 0
      : getTargetLinker(this.target.triple)
    const linkerEnv = `CARGO_TARGET_${targetToEnvVar(
      this.target.triple,
    )}_LINKER`
    if (linker && !process.env[linkerEnv] && !this.envs[linkerEnv]) {
      this.envs[linkerEnv] = linker
    }

    if (this.target.platform === 'android') {
      this.setAndroidEnv()
    }

    if (this.target.platform === 'wasi') {
      this.setWasiEnv()
    }

    if (this.target.platform === 'openharmony') {
      this.setOpenHarmonyEnv()
    }

    // Add custom environment variables
    if (this.options.env) {
      Object.assign(this.envs, this.options.env)
    }

    debug('Set envs: ')
    Object.entries(this.envs).forEach(([k, v]) => {
      debug('  %i', `${k}=${v}`)
    })

    return this
  }

  private setAndroidEnv() {
    const { ANDROID_NDK_LATEST_HOME } = process.env
    if (!ANDROID_NDK_LATEST_HOME) {
      debug.warn(
        `${colors.red(
          'ANDROID_NDK_LATEST_HOME',
        )} environment variable is missing`,
      )
    }

    // skip cross compile setup if host is android
    if (process.platform === 'android') {
      return
    }

    const targetArch = this.target.arch === 'arm' ? 'armv7a' : 'aarch64'
    const targetPlatform =
      this.target.arch === 'arm' ? 'androideabi24' : 'android24'
    const hostPlatform =
      process.platform === 'darwin'
        ? 'darwin'
        : process.platform === 'win32'
          ? 'windows'
          : 'linux'
    Object.assign(this.envs, {
      CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/${targetArch}-linux-android24-clang`,
      CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/${targetArch}-linux-androideabi24-clang`,
      TARGET_CC: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/${targetArch}-linux-${targetPlatform}-clang`,
      TARGET_CXX: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/${targetArch}-linux-${targetPlatform}-clang++`,
      TARGET_AR: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/llvm-ar`,
      TARGET_RANLIB: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/llvm-ranlib`,
      ANDROID_NDK: ANDROID_NDK_LATEST_HOME,
      PATH: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
    })
  }

  private setWasiEnv() {
    const { WASI_SDK_PATH } = process.env

    if (WASI_SDK_PATH && existsSync(WASI_SDK_PATH)) {
      this.envs.CARGO_TARGET_WASM32_WASI_PREVIEW1_THREADS_LINKER = join(
        WASI_SDK_PATH,
        'bin',
        'wasm-ld',
      )
      this.envs.CARGO_TARGET_WASM32_WASIP1_LINKER = join(
        WASI_SDK_PATH,
        'bin',
        'wasm-ld',
      )
      this.envs.CARGO_TARGET_WASM32_WASIP1_THREADS_LINKER = join(
        WASI_SDK_PATH,
        'bin',
        'wasm-ld',
      )
      this.envs.CARGO_TARGET_WASM32_WASIP2_LINKER = join(
        WASI_SDK_PATH,
        'bin',
        'wasm-ld',
      )
      this.setEnvIfNotExists('TARGET_CC', join(WASI_SDK_PATH, 'bin', 'clang'))
      this.setEnvIfNotExists(
        'TARGET_CXX',
        join(WASI_SDK_PATH, 'bin', 'clang++'),
      )
      this.setEnvIfNotExists('TARGET_AR', join(WASI_SDK_PATH, 'bin', 'ar'))
      this.setEnvIfNotExists(
        'TARGET_RANLIB',
        join(WASI_SDK_PATH, 'bin', 'ranlib'),
      )
      this.setEnvIfNotExists(
        'TARGET_CFLAGS',
        `--target=wasm32-wasi-threads --sysroot=${WASI_SDK_PATH}/share/wasi-sysroot -pthread -mllvm -wasm-enable-sjlj`,
      )
      this.setEnvIfNotExists(
        'TARGET_CXXFLAGS',
        `--target=wasm32-wasi-threads --sysroot=${WASI_SDK_PATH}/share/wasi-sysroot -pthread -mllvm -wasm-enable-sjlj`,
      )
      this.setEnvIfNotExists(
        `TARGET_LDFLAGS`,
        `-fuse-ld=${WASI_SDK_PATH}/bin/wasm-ld --target=wasm32-wasi-threads`,
      )
    }
  }

  private setOpenHarmonyEnv() {
    const { OHOS_SDK_PATH, OHOS_SDK_NATIVE } = process.env
    const ndkPath = OHOS_SDK_PATH ? `${OHOS_SDK_PATH}/native` : OHOS_SDK_NATIVE
    // @ts-expect-error
    if (!ndkPath && process.platform !== 'openharmony') {
      debug.warn(
        `${colors.red('OHOS_SDK_PATH')} or ${colors.red('OHOS_SDK_NATIVE')} environment variable is missing`,
      )
      return
    }
    const linkerName = `CARGO_TARGET_${this.target.triple.toUpperCase().replace(/-/g, '_')}_LINKER`
    const ranPath = `${ndkPath}/llvm/bin/llvm-ranlib`
    const arPath = `${ndkPath}/llvm/bin/llvm-ar`
    const ccPath = `${ndkPath}/llvm/bin/${this.target.triple}-clang`
    const cxxPath = `${ndkPath}/llvm/bin/${this.target.triple}-clang++`
    const asPath = `${ndkPath}/llvm/bin/llvm-as`
    const ldPath = `${ndkPath}/llvm/bin/ld.lld`
    const stripPath = `${ndkPath}/llvm/bin/llvm-strip`
    const objDumpPath = `${ndkPath}/llvm/bin/llvm-objdump`
    const objCopyPath = `${ndkPath}/llvm/bin/llvm-objcopy`
    const nmPath = `${ndkPath}/llvm/bin/llvm-nm`
    const binPath = `${ndkPath}/llvm/bin`
    const libPath = `${ndkPath}/llvm/lib`

    this.setEnvIfNotExists('LIBCLANG_PATH', libPath)
    this.setEnvIfNotExists('DEP_ATOMIC', 'clang_rt.builtins')
    this.setEnvIfNotExists(linkerName, ccPath)
    this.setEnvIfNotExists('TARGET_CC', ccPath)
    this.setEnvIfNotExists('TARGET_CXX', cxxPath)
    this.setEnvIfNotExists('TARGET_AR', arPath)
    this.setEnvIfNotExists('TARGET_RANLIB', ranPath)
    this.setEnvIfNotExists('TARGET_AS', asPath)
    this.setEnvIfNotExists('TARGET_LD', ldPath)
    this.setEnvIfNotExists('TARGET_STRIP', stripPath)
    this.setEnvIfNotExists('TARGET_OBJDUMP', objDumpPath)
    this.setEnvIfNotExists('TARGET_OBJCOPY', objCopyPath)
    this.setEnvIfNotExists('TARGET_NM', nmPath)
    this.envs.PATH = `${binPath}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`
  }

  private setFeatures() {
    const args = []
    if (this.options.allFeatures && this.options.noDefaultFeatures) {
      throw new Error(
        'Cannot specify --all-features and --no-default-features together',
      )
    }
    if (this.options.allFeatures) {
      args.push('--all-features')
    } else if (this.options.noDefaultFeatures) {
      args.push('--no-default-features')
    }
    if (this.options.features) {
      args.push('--features', ...this.options.features)
    }

    debug('Set features flags: ')
    debug('  %O', args)
    this.args.push(...args)

    return this
  }

  private setBypassArgs() {
    if (this.options.release) {
      this.args.push('--release')
    }

    if (this.options.verbose) {
      this.args.push('--verbose')
    }

    if (this.options.targetDir) {
      this.args.push('--target-dir', this.options.targetDir)
    }

    if (this.options.profile) {
      this.args.push('--profile', this.options.profile)
    }

    if (this.options.manifestPath) {
      this.args.push('--manifest-path', this.options.manifestPath)
    }

    if (this.options.cargoArgs?.length) {
      this.args.push(...this.options.cargoArgs)
    }

    return this
  }

  private async exec(): Promise<CrossBuildResult> {
    debug('Start cross-building')
    debug('  %i', `cargo ${this.args.join(' ')}`)

    if (this.options.useCross && this.options.crossCompile) {
      throw new Error('`useCross` and `crossCompile` cannot be used together')
    }

    const command =
      process.env.CARGO ?? (this.options.useCross ? 'cross' : 'cargo')

    return new Promise((resolve, reject) => {
      const buildProcess = spawn(command, this.args, {
        env: { ...process.env, ...this.envs },
        stdio: 'inherit',
        cwd: this.cwd,
      })

      buildProcess.once('exit', (code) => {
        if (code === 0) {
          debug('%i', 'Build completed successfully!')
          resolve({
            success: true,
            target: this.target,
            envs: { ...this.envs },
          })
        } else {
          reject(new Error(`Build failed with exit code ${code}`))
        }
      })

      buildProcess.once('error', (e) => {
        reject(new Error(`Build failed with error: ${e.message}`, { cause: e }))
      })
    })
  }

  private setEnvIfNotExists(env: string, value: string) {
    if (!process.env[env]) {
      this.envs[env] = value
    }
  }
}
