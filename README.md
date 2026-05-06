# Steam Uploader

Desktop helper for exporting Godot builds and uploading them to SteamPipe.

Steam Uploader wraps the Steamworks SDK ContentBuilder/SteamCMD workflow. It does not include or download Steamworks files; each user must select their own Steamworks SDK `tools\ContentBuilder` folder locally.

## Launch

For normal use, download the latest portable `.exe` from GitHub Releases and run it directly. The app is unsigned, so Windows may show an "unknown publisher" warning.

When running from source, double-click `Launch Steam Uploader.cmd`. It starts the app without requiring you to open a terminal first.

If the app does not open, double-click `Launch Steam Uploader Debug.cmd` instead. That keeps a terminal window open so startup errors are visible.

The quiet launcher writes startup output to `steam-uploader-launch.log` and `steam-uploader-launch.err.log`.

## Development

Install dependencies once:

```powershell
npm ci
```

Run the app in development mode:

```powershell
npm run dev
```

## Build A Portable EXE

Create a single portable Windows executable:

```powershell
npm run dist:portable
```

The executable is written to `release/`.

## GitHub Releases

This repo includes a GitHub Actions release workflow. To publish a release, push a version tag:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions will build the portable Windows `.exe` and attach it to the GitHub Release.
