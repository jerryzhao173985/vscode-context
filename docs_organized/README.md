# ContextPack-Pro Documentation

This directory contains essential documentation for ContextPack-Pro v1.0.0, organized by category.

## Structure

### Architecture (`/architecture`)
High-level system design and technical implementation details:
- **system-architecture.md**: Overall architecture diagrams and component relationships
- **technical-overview.md**: Deep dive into technical implementation and design patterns

### Features (`/features`)
Feature-specific documentation (one doc per major feature):
- **git-integration.md**: Git-aware context with diffs, commits, and branch info
- **dependency-detection.md**: Automatic detection of project dependencies and tech stack
- **pattern-selection.md**: Smart file pattern matching and glob-based selection
- **token-optimization.md**: Token counting, cost estimation, and context size optimization
- **treeview.md**: Visual TreeView explorer UI implementation

### Guides (`/guides`)
User and developer guides:
- **getting-started.md**: Quick start guide for using ContextPack-Pro
- **implementation-roadmap.md**: Development roadmap and feature priorities

## Quick Links

- **New to ContextPack-Pro?** Start with `/guides/getting-started.md`
- **Understanding the system?** Read `/architecture/system-architecture.md`
- **Implementing a feature?** Check the relevant `/features/*.md` document
- **Planning development?** Review `/guides/implementation-roadmap.md`

## Documentation Principles

Each feature document follows this structure:
1. **Overview**: What the feature does and why it exists
2. **Implementation**: How it's implemented technically
3. **Usage**: How users interact with the feature
4. **Configuration**: Available settings and customization
5. **Examples**: Real-world usage scenarios

## Related Files

- `CLAUDE.md`: AI assistant instructions (in project root)
- `README.md`: Project README (in project root)
- Additional research docs are in `/research` (historical/exploratory)
