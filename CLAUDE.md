# Publii MCP Development Guide

> **Language**: English for all code and documentation.

## Project Overview

**Publii** is a desktop-based Static Site CMS with MCP (Model Context Protocol) integration.

- **Website**: https://getpublii.com/
- **Upstream**: https://github.com/GetPublii/Publii
- **Fork Version**: 0.47.4-mcp.3 (build 17405)
- **License**: GPL-3.0

### Technical Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vue.js 2.x, Vuex, SCSS |
| Backend | Electron, Node.js, SQLite |
| Templates | Handlebars |
| Images | Sharp |

---

## MCP Integration

The MCP server is built into `Publii-fork/app/back-end/mcp/`:

```
mcp/
├── cli.js              # Entry point for Claude Desktop/Code
├── events/mcp.js       # IPC handlers for UI communication
└── tools/
    ├── sites.js        # list_sites, get_site_config, create_site, delete_site
    ├── posts.js        # list_posts, get_post, create_post, update_post, delete_post
    ├── pages.js        # list_pages, get_page, create_page, update_page, delete_page
    ├── tags.js         # list_tags, get_tag, create_tag, update_tag, delete_tag
    ├── menus.js        # get_menu, set_menu, add_menu_item, remove_menu_item, clear_menu
    ├── media.js        # list_media, upload_image, upload_file, delete_media, get_media_info
    └── deploy.js       # render_site, deploy_site, get_sync_status
```

### Configuration

**Claude Desktop** (`~/.config/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "publii": {
      "command": "node",
      "args": ["/opt/Publii/resources/app/back-end/mcp/cli.js"]
    }
  }
}
```

**Claude Code**:
```bash
claude mcp add publii node /opt/Publii/resources/app/back-end/mcp/cli.js
```

### MCP must be enabled in Publii

Go to **Settings → Experimental Features → Enable MCP Integration**

---

## Database Lock Status

The MCP server shows visual feedback when writing to the database.

### Status Indicators (Sidebar)

| Status | Color | Meaning |
|--------|-------|---------|
| 🔴 Red (fast pulse) | Locked | Writing to database |
| 🟢 Bright green (scale) | Completed | Write just finished |
| 🟢 Green (slow pulse) | Active | Connected, idle |
| 🟡 Yellow | Idle | No recent activity |
| ⚫ Gray | Inactive | No connection |

### Lock File Format

```json
// ~/Documents/Publii/config/mcp-status.json
{
  "clients": [{ "sessionId": "...", "clientName": "Claude Code", "pid": 12345 }],
  "activeLock": { "site": "my-blog", "operation": "create_post", "startedAt": ... },
  "lastLock": { "operation": "create_post", "clearedAt": ..., "duration": 150 }
}
```

### Write Operations (trigger lock)

`create_post`, `update_post`, `delete_post`, `create_page`, `update_page`, `delete_page`, `create_tag`, `update_tag`, `delete_tag`, `upload_image`, `upload_file`, `delete_media`, `render_site`, `deploy_site`

---

## Data Locations

```
~/Documents/Publii/
├── config/
│   ├── app-config.json          # App settings
│   └── mcp-status.json          # MCP client status
├── sites/[site-name]/
│   └── input/
│       ├── config/
│       │   ├── site.config.json
│       │   ├── menu.config.json
│       │   └── theme.config.json
│       ├── db.sqlite            # Content database
│       ├── media/               # Images, files
│       └── themes/              # Site themes
│   ├── output/                  # Generated static site
│   └── preview/                 # Preview builds
└── themes/                      # Global themes
```

---

## Database Schema

### Key Tables

```sql
-- Posts and Pages (pages have status like "published,is-page")
CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  title TEXT,
  slug TEXT,
  text TEXT,                    -- HTML content
  status TEXT,                  -- 'published', 'draft', 'hidden', 'trashed'
  authors TEXT,                 -- Author ID
  featured_image_id INTEGER,
  created_at DATETIME,
  modified_at DATETIME
);

-- Additional metadata (JSON blobs)
CREATE TABLE posts_additional_data (
  post_id INTEGER,
  key TEXT,                     -- '_core', 'postViewSettings'
  value TEXT                    -- JSON
);

-- Tags
CREATE TABLE tags (id, name, slug, description, additional_data);
CREATE TABLE posts_tags (post_id, tag_id);

-- Authors
CREATE TABLE authors (id, name, username, config, additional_data);

-- Images
CREATE TABLE posts_images (id, post_id, url, title, caption, additional_data);
```

---

## Development

### Quick Start

```bash
cd Publii-fork
npm install && cd app && npm install && cd ..
npm run prod
npm run prepare-editor    # Required! Copies jQuery/TinyMCE
npm run build2            # Start in dev mode
```

### Build Packages (Linux)

```bash
npm run prod && npm run prepare-editor
npx electron-builder build --linux deb AppImage
# Output: dist/Publii_0.47.4-mcp.3_amd64.deb
```

### Build Packages (Windows)

Windows builds cannot be created on Linux. Use GitHub Actions instead:

1. Commit and push changes to the repository
2. Create a new tag: `git tag v0.47.4-mcp.3 && git push origin v0.47.4-mcp.3`
3. GitHub Actions will automatically build Windows packages on tag push
4. Download the Windows installer from the GitHub Releases page

---

## Key Lessons Learned

### Database

1. **Pages are posts** with `status = "published,is-page"`
2. **Additional data required**: Pages need `_core` and `pageViewSettings` in posts_additional_data
3. **Menu items**: Only need `link` field (page ID), not `linkID`
4. **better-sqlite3**: Parameters without `$` prefix in object, but with `$` in SQL

### Publii Architecture

1. **Theme copying**: New sites need theme files copied to site directory
2. **Custom CSS**: Put in `theme.config.json` → `customConfig.customCSS`
3. **Asar disabled**: Required for external MCP CLI execution

### MCP Implementation

1. **Use Publii classes**: Post, Page, Tag classes handle validation
2. **Sequential queue**: Prevents database locks between requests
3. **Lock visibility**: `lastLock` preserved 3s for UI display

---

## Security

- **Passwords**: Stored in system keychain via `keytar`
- **Database**: Always use prepared statements
- **MCP Lock**: Prevents concurrent write conflicts

---

## Resources

- [Publii Docs](https://getpublii.com/docs/)
- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [MCP README](Publii-fork/app/back-end/mcp/README.md) - User documentation

---

**Version**: 2.7 | **Updated**: 2026-01-04

### Recent Changes

**v2.7** - Windows build fix (EEXIST error), Windows build via GitHub Actions
**v2.6** - Deploy tools (`render_site`, `deploy_site`, `get_sync_status`)
**v2.5** - Database lock status with visual indicators
**v2.4** - Linux packaging (deb, AppImage), asar disabled
