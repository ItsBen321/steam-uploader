# Steam Uploader

Cross-platform desktop helper for exporting Godot builds and uploading them to SteamPipe on Windows and Linux.

Steam Uploader wraps the Steamworks SDK ContentBuilder/SteamCMD workflow. It does not include or download Steamworks files; each user must select their own Steamworks SDK `tools\ContentBuilder` folder locally.

## Launch

For normal use, download the build for your operating system from GitHub Releases:

- Windows: run the portable `.exe`. The app is unsigned, so Windows may show an "unknown publisher" warning.
- Linux: make the `.AppImage` executable and run it:

```bash
chmod +x Steam-Uploader-*-linux-x86_64.AppImage
./Steam-Uploader-*-linux-x86_64.AppImage
```

On Linux, select the Steamworks SDK `tools/ContentBuilder` folder containing `builder_linux/steamcmd.sh`. The terminal login button supports common terminal emulators and honors `STEAM_UPLOADER_TERMINAL` when set.

### Running from source

On Windows, double-click `Launch Steam Uploader.cmd`. It starts the app without requiring you to open a terminal first.

If the app does not open, double-click `Launch Steam Uploader Debug.cmd` instead. That keeps a terminal window open so startup errors are visible.

The quiet launcher writes startup output to `steam-uploader-launch.log` and `steam-uploader-launch.err.log`.

On Linux, run:

```bash
./Launch\ Steam\ Uploader.sh
```

## Development

Install dependencies once:

```bash
npm ci
```

Run the app in development mode:

```bash
npm run dev
```

## Build Distributables

Create a portable Windows executable on Windows:

```bash
npm run dist:windows
```

Create a Linux AppImage on Linux:

```bash
npm run dist:linux
```

Distributables are written to `release/`.

## GitHub Releases

This repo includes a GitHub Actions release workflow. To publish a release, push a version tag:

```bash
git tag v0.2.0
git push origin v0.2.0
```

GitHub Actions builds both distributables for pushes to `main`, version tags, and manually dispatched workflows. Main-branch and manual builds are retained as workflow artifacts. Version tags also attach both files to the same GitHub Release.
