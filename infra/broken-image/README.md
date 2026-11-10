# Broken release image

`kairo/broken-release:1` is the image Break It deploys (FR-63). It exits with
code 1 as soon as it starts, so the pod crash-loops, `KairoCrashLoop` fires and
Kairo rolls the app back to its last healthy release.

The backend builds it on the first Break It (`src/testpanel/break.service.js`).
To build it by hand:

```bash
docker build -t kairo/broken-release:1 infra/broken-image
```
