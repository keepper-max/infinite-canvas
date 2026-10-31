# Third-party notices

## Browser-local depth motion conversion

The local depth-video workflow is informed by [BeatAPI/depth-video-studio](https://github.com/BeatAPI/depth-video-studio), Copyright BeatAPI contributors, licensed under the MIT License.

It uses the following separately licensed components at runtime:

- `@huggingface/transformers` — Apache License 2.0.
- Depth Anything V2 Small model files — Apache License 2.0; downloaded from the pinned upstream model revision and cached by the browser, not redistributed in this repository.
- `mediabunny` — Mozilla Public License 2.0.

The complete dependency license texts remain available in their installed packages and upstream repositories.

## AutoCut media runtime

AutoCut invokes the existing FFmpeg executable as a separate process. The actual FFmpeg build and its enabled libraries determine its licensing; the tested developer build includes GPL components including libx264. Verify and fulfill the obligations of the actual distributed build and provide corresponding notices/sources where applicable.

The optional CPU speech bridge uses a separately provisioned FunASR installation and separately licensed ASR/VAD/punctuation model weights. These packages and weights are not redistributed in this repository. Model license and source review evidence is recorded in `docs/worklogs/autocut/components.md`.

No OpenChatCut AGPL editor code, or complete third-party editing application, was integrated. Pinned upstream README/license/source inspection copies under `docs/worklogs/autocut/sources/` retain their companion upstream license files.

## AutoCut P1 optional project export

The opt-in export bridge calls [pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft) 0.3.1 at commit `1e228479dda361e312e85f6037002346cf6dca9a` (Apache-2.0), [OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO) 0.18.1 (Apache-2.0), and `otio-fcp-adapter` 1.0.0 (Apache-2.0). These SDKs live in an independent Python environment; package license files remain in those distributions. The optional lock lists the exact source commit and package versions. The SDK calls and compatibility limitations are documented in `docs/worklogs/autocut-p1/README.md`.

pyCapCut 0.0.4 at reviewed commit `ec61408d9f039c4045f946370bb35746b89b2479` had no license file or declared package license. It is not installed, redistributed or enabled. No target editor compatibility is claimed without separate acceptance.

## Pose and costume reference workflow

The reference workflow and prompt responsibilities are adapted from:

- Open Pose & Costume, commit `0cc039e096ac4ec2e2a24c2972e5e9c930235cb1`, Copyright (c) 2026 open-pose-costume contributors.
- Open Pose & Costume Skill, commit `5004fbdb42487cdfe95351b6a41ee11938b33a23`, Copyright (c) 2026 HongyeMain.

Their original application code / skill documents are MIT licensed. This does not license gallery images, original catalog data or third-party translations. We query the public index at the reviewed revision; the complete index and image archives are not bundled or mirrored here. See their SOURCES.md and THIRD_PARTY_NOTICES.md.

Portrait images: あぎ, https://ai-portrait-gallery.pages.dev/ — the source declares CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/) and separately requests avoiding image redistribution/republication. Only visible CC0 thumbnails and individually selected originals are read; selected images are saved into the current project's existing asset service. No complete image mirror is provided.

Pose, costume and optional pose-depth images: ギア, https://x.com/giaaibusi — the source sites allow individual creative reference but prohibit bulk automated download, image republication, redistribution and resale. The maintainer's additional archive permission applies to the upstream repository and grants us no downstream rights. Image display/import for these categories remains disabled in public production builds pending suitable permission. A loopback development session permits personal, individually selected creative references from the original sites, including the chosen pose depth view. No bulk image mirror or additional redistribution right is provided.

Chinese pose names are attributed upstream to Anhao (https://github.com/anhao/ai-pose-gallery-zh). Its code MIT notice excludes original image/data rights and includes a noncommercial restriction on those resources. No right to commercially redistribute those labels/data is claimed by this integration; they are queried externally, not vendored. Commercial catalog reuse requires clarification from the relevant rightsholders.

MIT License (original code and skill materials only)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
