# @aspect-build/rust-cross-build

Cross-compile Rust projects without Docker.

This package extracts the cross-compilation logic from `@napi-rs/cli` into a standalone package that can be used by any Rust project, not just those using NAPI-RS.

## Features

- **Cross-compile for Linux targets** using `@napi-rs/cross-toolchain`
- **Cross-compile for Windows** using `cargo-xwin`
- **Cross-compile for other platforms** using `cargo-zigbuild`
- **Android NDK support** for Android targets
- **WASI support** for WebAssembly targets
- **OpenHarmony support** for HarmonyOS targets

## Installation

```bash
npm install @aspect-build/rust-cross-build
# or
yarn add @aspect-build/rust-cross-build
# or
pnpm add @aspect-build/rust-cross-build
```

## Usage

### Basic Build

```typescript
import { build } from '@aspect-build/rust-cross-build'

// Cross-compile for Linux ARM64
const result = await build({
  target: 'aarch64-unknown-linux-gnu',
  release: true,
  useNapiCross: true,
})

console.log('Build succeeded:', result.success)
console.log('Environment variables used:', result.envs)
```

### Get Cross-Compile Environment Variables

If you want to get the environment variables needed for cross-compilation without actually building, you can use `getCrossCompileEnv`:

```typescript
import { getCrossCompileEnv } from '@aspect-build/rust-cross-build'

const env = getCrossCompileEnv({
  target: 'aarch64-unknown-linux-gnu',
  useNapiCross: true,
})

console.log(env)
// {
//   CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER: '...',
//   TARGET_CC: '...',
//   TARGET_CXX: '...',
//   ...
// }
```

### Parse Target Triple

```typescript
import { parseTriple } from '@aspect-build/rust-cross-build'

const target = parseTriple('aarch64-unknown-linux-gnu')
console.log(target)
// {
//   triple: 'aarch64-unknown-linux-gnu',
//   platform: 'linux',
//   arch: 'arm64',
//   abi: 'gnu',
//   platformArchABI: 'linux-arm64-gnu'
// }
```

## Options

### `CrossBuildOptions`

| Option | Type | Description |
|--------|------|-------------|
| `target` | `string` | Target triple (e.g., 'aarch64-unknown-linux-gnu') |
| `cwd` | `string` | Working directory for the build |
| `manifestPath` | `string` | Path to Cargo.toml manifest file |
| `targetDir` | `string` | Directory for build artifacts |
| `release` | `boolean` | Build in release mode |
| `verbose` | `boolean` | Show verbose output |
| `profile` | `string` | Build profile (e.g., 'release', 'dev') |
| `useNapiCross` | `boolean` | Use @napi-rs/cross-toolchain for Linux cross-compilation |
| `crossCompile` | `boolean` | Use cargo-zigbuild/cargo-xwin for cross-compilation |
| `useCross` | `boolean` | Use cross-rs instead of cargo |
| `strip` | `boolean` | Strip debug symbols |
| `package` | `string` | Package name in workspace |
| `bin` | `string` | Binary name to build |
| `features` | `string[]` | Features to enable |
| `allFeatures` | `boolean` | Enable all features |
| `noDefaultFeatures` | `boolean` | Disable default features |
| `cargoArgs` | `string[]` | Additional cargo arguments |
| `env` | `Record<string, string>` | Additional environment variables |

## Supported Targets

### Linux Targets (via `@napi-rs/cross-toolchain`)

- `aarch64-unknown-linux-gnu`
- `aarch64-unknown-linux-musl`
- `x86_64-unknown-linux-gnu`
- `x86_64-unknown-linux-musl`
- `armv7-unknown-linux-gnueabihf`
- `riscv64gc-unknown-linux-gnu`
- `powerpc64le-unknown-linux-gnu`
- `s390x-unknown-linux-gnu`
- And more...

### Windows Targets (via `cargo-xwin`)

- `x86_64-pc-windows-msvc`
- `i686-pc-windows-msvc`
- `aarch64-pc-windows-msvc`

### Other Platforms (via `cargo-zigbuild`)

- macOS (cross-arch)
- FreeBSD
- And more...

## License

MIT
