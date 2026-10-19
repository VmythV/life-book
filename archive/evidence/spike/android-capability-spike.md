# Android TD-001 capability spike evidence

> Evidence date: 2026-08-12 through 2026-08-13 (Asia/Shanghai)  
> Scope: Android only, synthetic technical-feasibility evidence  
> Status: **PASS — Android-only emulator and physical-device feasibility gates completed**

This report records the removable Android spike required by IMP-107. It does not
activate a production database schema, attachment format, notification contract,
credential envelope, telemetry exporter, or release channel, and it is deliberately
excluded from `evidence/conformance/index.json`.

## Build identity

- Repository HEAD: `63ed336076a483cd5b5cd46239d9dbb970a8623f`.
- Worktree: dirty because this implementation has not been committed; the source
  digest below binds the uncommitted spike source used for the artifact.
- Spike source SHA-256 digest:
  `39d540d8923fc0309035c859a98526d1d36a2a96dff60780fc8742103b4e41f9`.
- APK SHA-256:
  `6dfe349a63c76558e39001e9a76a8cd62d65dcf15a3927d346cd53fe745cf960`.
- Variant: Gradle `release`, locally debug-signed; this is not a production-signed
  release candidate.
- Android bounds: min SDK 29, compile/target SDK 36, build tools 36.0.0.
- Runtime/build: New Architecture, Hermes V1, Java 17.0.20, NDK 27.1.12297006.
- Retained ignored build artifacts:
  `dist/android/life-book-android-capability-spike-release.apk`, the matching Hermes
  source map, native symbols archive, and machine-readable build JSON.

Exact direct runtime dependencies:

| Dependency                  | Version |
| --------------------------- | ------- |
| `expo`                      | 57.0.12 |
| `expo-build-properties`     | 57.0.10 |
| `expo-crypto`               | 57.0.1  |
| `expo-document-picker`      | 57.0.1  |
| `expo-file-system`          | 57.0.2  |
| `expo-local-authentication` | 57.0.2  |
| `expo-notifications`        | 57.0.10 |
| `expo-secure-store`         | 57.0.1  |
| `expo-sharing`              | 57.0.11 |
| `expo-sqlite`               | 57.0.1  |
| `expo-task-manager`         | 57.0.9  |
| `react`                     | 19.2.3  |
| `react-native`              | 0.86.2  |

## Environments and procedure

The final APK was installed and executed in these environments:

| Environment                | Identity                                                                                                                      | Configuration                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Physical Xiaomi 2211133C   | API 36; Android 16; security patch 2026-06-01; `Xiaomi/fuxi/fuxi:16/BP2A.250605.031.A3/OS3.0.308.0.WMCCNXM:user/release-keys` | Device-secure with enrolled biometric, official TalkBack installed, notification permission initially denied, arm64 hardware. |
| Android 10 emulator        | API 29; `google/sdk_gphone64_arm64/emulator64_arm64:10/QSR1.211112.011/13135432:userdebug/dev-keys`                           | Minimum-OS run plus a separate run at font scale 2.00 with all animation scales zero.                                         |
| Android 16 Google emulator | API 36; `google/sdk_gphone64_arm64/emu64a:16/BE2A.250530.026.F3/13894323:userdebug/dev-keys`                                  | PIN, enrolled emulator fingerprint, notification permission, exact-alarm capability, and system picker/share UI.              |

Reproduction commands use only root scripts and the installed Android SDK:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm spike:android:isolation:check
corepack pnpm build:spike:android
adb install -r -t dist/android/life-book-android-capability-spike-release.apk
adb shell am start -W -a android.intent.action.VIEW \
  -d 'lifebook-capability-spike://probe/autorun' \
  dev.lifebook.capabilityspike
```

The physical-device sequence targeted its ADB serial explicitly so the concurrently
connected emulator could not receive commands. It cleared only
`dev.lifebook.capabilityspike`, installed the hash-matched APK, ran the automatic probes,
and exercised system UI from labeled interactive controls. Manual biometric, picker,
share, credential-change, diagnostics, and TalkBack outcomes were confirmed by the user.

## Results

| Capability                   | Result               | Observed evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean CNG and release build  | PASS                 | Clean Android prebuild produced an APK for all four packaged ABIs. Final audit found Hermes and SQLCipher native libraries for `arm64-v8a`, `armeabi-v7a`, `x86`, and `x86_64`; generated Android source was removed afterward.                                                                                                                                                                                                                                                                               |
| SQLCipher                    | PASS                 | SQLCipher 4.7.0 community created a synthetic encrypted database, committed and rolled back transactions, applied a candidate migration, closed/reopened with the correct key, rejected a wrong key, and deleted the database on both emulator levels and the physical device. No format is retained as a production owner.                                                                                                                                                                                   |
| Encrypted 50 MiB file        | PASS                 | On the physical device and emulators, 50 MiB was written/read in 1 MiB chunks with AES-256-GCM and synthetic AAD; tampering failed authentication. A cancelled write stopped after three chunks and cleanup left zero residual probe files.                                                                                                                                                                                                                                                                   |
| Notification                 | PASS                 | Synthetic category/channel and request schedule/list/cancel passed. Android 10 reported `not_required`; the physical Android 16 device correctly reported `approximate_only`. The physical permission prompt was granted only to the spike, a new five-second notification was matched by exact synthetic title, and tapping it returned to the spike with `notification tap/action response reached the application`. Emulator evidence additionally covered the explicit action and narrow background task. |
| Keystore and authentication  | PASS with limitation | The physical automatic probe reported `deviceSecure=true; biometric=true` and passed synthetic wrap/unwrap/delete. Controlled authentication cancellation returned `user_cancel`; the user confirmed authenticated Keystore as PASS. After staging a key, changing the physical device PIN, and authenticating again, the user observed `preserved`; callers must not assume PIN-change invalidation.                                                                                                         |
| Picker, share, and deep link | PASS                 | On the physical device, the user confirmed controlled document-picker cancellation and share-sheet cancellation as PASS. The allowlisted `lifebook-capability-spike://probe/autorun` link was accepted on the physical device and both emulators and triggered probes without persisting the external URI.                                                                                                                                                                                                    |
| Lifecycle and secure cover   | PASS                 | Emulator foreground/background, kill/relaunch, privacy-cover, and narrow background-entry checks passed. The physical device was repeatedly force-stopped and cold-started successfully, and `dumpsys window` reported the spike MainActivity with `SECURE`. The user accepted the remaining lifecycle sample as OK and requested no further device automation.                                                                                                                                               |
| Accessibility sample         | PASS                 | Every control exposes a button role and label. Measured control height is 147 px at density 420, equal to 56 dp. The Android 10 suite passed at font scale 2.00 with animation scales zero. Official TalkBack was present on the physical device; after closing its first-use UI, the user manually traversed the spike and confirmed labels, roles, reachability, and absence of a focus trap as PASS.                                                                                                       |
| Diagnostics                  | PASS                 | Only allowlisted code/outcome events are retained; the user confirmed the content-free diagnostic probe as PASS. The sample contains no life content, key, path, or SDK exception. The build emitted a Hermes source map and native debug-symbol archive.                                                                                                                                                                                                                                                     |
| Product isolation            | PASS                 | The spike is a separate Android-only Expo app and local Kotlin module. Static checks reject spike dependencies, application ID, scheme, or module markers in `apps/mobile`; the product APK does not register spike permissions or routes.                                                                                                                                                                                                                                                                    |

## Known limitations and decision

- The credential test demonstrates that changing the device PIN did not invalidate this
  authentication-bound SecureStore item. A future production credential envelope must
  specify its own invalidation/rewrap behavior instead of relying on PIN-change deletion.
- The physical device exposed approximate-only exact-alarm capability. Future product
  reminders must preserve this explicit capability/degradation path rather than promise
  exact delivery.
- Automated TalkBack gesture driving was abandoned because the Xiaomi enhancement layer
  opened a permission-controller surface. TalkBack and the enhancement service were
  disabled, touch exploration and animation/font settings were restored, and a read-only
  audit found no new sensitive TalkBack permission. Screen-reader acceptance therefore
  uses the user's manual physical-device result.
- The APK is a local release-configuration feasibility artifact signed with a debug key.
  It is neither a store/release candidate nor release evidence.
- Device observations and user-confirmed manual results are local implementation evidence,
  not formal contract conformance, and are intentionally absent from the conformance index.
- iOS is outside the implementation scope by explicit product direction; no iOS result is
  inferred from this Android evidence.

Decision: the Android-only IMP-107 feasibility gate is complete. Retain
`apps/android-capability-spike` through M0 review as a reproducible diagnostic target; it may
then be deleted as one directory. The static isolation gate demonstrates that deletion does
not alter the product composition root or product dependencies.
