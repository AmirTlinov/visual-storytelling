const uvVersion = '0.11.3';
const chromiumVersion = '153.0.8010.12';
const ffmpegSnapshot = 'autobuild-2026-09-30-13-08';
const linuxFFmpegVersion = 'n8.1.3-9-g29e619e767';

const uv = (target, digest) => ({
  version: uvVersion,
  url: `https://releases.astral.sh/github/uv/releases/download/${uvVersion}/uv-${target}.tar.gz`,
  algorithm: 'sha256',
  digest,
  binary: `uv-${target}/uv`,
  archive: 'tgz',
});
const chromium = (target, digest) => ({
  version: chromiumVersion,
  url: `https://cdn.playwright.dev/builds/cft/${chromiumVersion}/${target}/chrome-headless-shell-${target}.zip`,
  algorithm: 'sha256',
  digest,
  binary: `chrome-headless-shell-${target}/chrome-headless-shell`,
  archive: 'zip',
});
const linuxFFmpeg = (target, digest) => ({
  version: `${linuxFFmpegVersion}-${ffmpegSnapshot}`,
  url: `https://github.com/BtbN/FFmpeg-Builds/releases/download/${ffmpegSnapshot}/ffmpeg-${linuxFFmpegVersion}-${target}-gpl-8.1.tar.xz`,
  algorithm: 'sha256',
  digest,
  binary: `ffmpeg-${linuxFFmpegVersion}-${target}-gpl-8.1/bin/ffmpeg`,
  archive: 'txz',
  license: 'GPL-3.0-or-later',
  licenseURL: 'https://www.gnu.org/licenses/gpl-3.0.html',
  upstreamSource: 'https://github.com/FFmpeg/FFmpeg/tree/29e619e767',
  sourceCode: `https://github.com/BtbN/FFmpeg-Builds/tree/${ffmpegSnapshot}`,
});

// Every download is a fixed upstream artifact with a verified archive SHA-256.
// Linux FFmpeg needs libx264 for software H.264; the macOS build uses VideoToolbox.
const profiles = {
  'darwin-arm64': {
    encoder: 'h264_videotoolbox',
    resources: {
      uv: uv(
        'aarch64-apple-darwin',
        '2bc3d0c7bf2bd08325b1e170abac6f7e5b3346e1d4eab3370d17cefec934996f',
      ),
      chromium: chromium(
        'mac-arm64',
        '89d80a6d26ccd0ccfd51e22d9e1297283862af2b0cd91dce07459b35ca0059f2',
      ),
      ffmpeg: {
        version: '8.0.3-build4',
        url: 'https://github.com/AtlasYang/ffmpeg-static-builds/releases/download/ffmpeg-8.0.3-build4/ffmpeg-8.0.3-macos-arm64.tar.gz',
        algorithm: 'sha256',
        digest: '26f6269b117a51c5fdfd3a870c4e0a62b99f0575740a3933fc3d852f0a3f80b1',
        binary: 'ffmpeg',
        archive: 'tgz',
        license: 'LGPL-2.1-or-later',
        licenseURL: 'https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html',
        sourceCode: 'https://github.com/AtlasYang/ffmpeg-static-builds/tree/ffmpeg-8.0.3-build4',
      },
    },
  },
  'linux-x64': {
    encoder: 'libx264',
    resources: {
      uv: uv(
        'x86_64-unknown-linux-gnu',
        'c0f3236f146e55472663cfbcc9be3042a9f1092275bbe3fe2a56a6cbfd3da5ce',
      ),
      chromium: chromium(
        'linux64',
        'a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d',
      ),
      ffmpeg: linuxFFmpeg(
        'linux64',
        '97ce978979194b5cf7e06a5e68020dbdaa7a4f3294c5452b6a1bc347100dbb79',
      ),
    },
  },
  'linux-arm64': {
    encoder: 'libx264',
    resources: {
      uv: uv(
        'aarch64-unknown-linux-gnu',
        '711382e3158433f06b11d99afb440f4416359fc3c84558886d8ed8826a921bff',
      ),
      chromium: chromium(
        'linux-arm64',
        'd433c45172c7836e38124fe545f767b02210bfb43a6262f08a297473a8e91c99',
      ),
      ffmpeg: linuxFFmpeg(
        'linuxarm64',
        '10523d1e0be6b3ce62a9708cc50815c4b5eb5f36ae147fbe2afeecda6f2d6845',
      ),
    },
  },
};

export function environmentProfile(platform = process.platform, arch = process.arch) {
  return profiles[`${platform}-${arch}`];
}

export function requireEnvironmentProfile() {
  const profile = environmentProfile();
  if (!profile)
    throw new Error(
      `Automatic tool preparation does not support ${process.platform}-${process.arch}.`,
    );
  return profile;
}
