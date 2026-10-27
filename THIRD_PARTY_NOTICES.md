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
