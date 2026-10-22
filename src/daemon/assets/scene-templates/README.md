# Last Bus template artwork

These stills come from the supplied `末班 (项目).zip` project. They are resized
to 1280 × 720 WebP at quality 80; the source project is not needed at runtime.

| File                | Original project file           | Templates    |
| ------------------- | ------------------------------- | ------------ |
| `cover.webp`        | `assets/library/1_01.jpg`       | Blank        |
| `menu.webp`         | `assets/library/output-4.png`   | Main menu    |
| `phone.webp`        | `assets/library/10-16.png`      | Choice       |
| `bell.webp`         | `assets/library/点击.png`       | QTE          |
| `cabin.webp`        | `assets/imported/output-24.png` | Hotspot      |
| `ending.webp`       | `assets/library/output-7.png`   | Ending       |
| `station.webp`      | `assets/imported/output-22.png` | Visual Novel |
| `store-window.webp` | `assets/imported/output-13.png` | Story map    |

`playable-template-artwork.ts` embeds each illustration in project-owned CSS
when its template is first used. The host build copies these files to
`dist/daemon/assets/scene-templates/`; desktop packaging includes the WebPs.
Template picker pictures in `src/renderer/assets/templates/` are captures of
the corresponding rendered Scenes, including their controls and text.
