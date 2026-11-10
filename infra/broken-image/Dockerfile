# Break It's broken release (FR-63): starts, prints one line, exits with 1.
# Kubernetes restarts it, it exits again, and the pod ends in CrashLoopBackOff,
# which fires KairoCrashLoop and makes Kairo roll back.
#
# One image for every app: what it runs doesn't matter, only that it never
# stays up. node:22-slim is already on the laptop (every Node build uses it),
# so building this pulls nothing new. The backend builds it once, on the first
# Break It, as kairo/broken-release:1.
FROM node:22-slim
CMD ["node", "-e", "console.error('Kairo Break It: this release exits on start'); process.exit(1)"]
