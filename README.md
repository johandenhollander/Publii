# Publii MCP - AI-Powered Static Site Management

[![GPLv3 license](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://github.com/GetPublii/Publii/blob/master/LICENSE)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-brightgreen.svg)](https://modelcontextprotocol.io/)
[![Based on Publii](https://img.shields.io/badge/Based%20on-Publii%200.47.4-blue.svg)](https://getpublii.com/)

**Static site management through AI assistants.** This fork extends [Publii](https://getpublii.com/) with [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) support, enabling any MCP-compatible AI to manage your websites.

**Current version: 0.47.4-mcp.1 (build 17405)**

---

## What is MCP?

The **Model Context Protocol** is an open standard developed by Anthropic that allows AI assistants to interact with external tools and services. With Publii MCP, your AI assistant becomes a capable web content manager.

### Supported AI Assistants

Any MCP-compatible AI can work with Publii MCP:
- **Claude** (Desktop & Code)
- **Other MCP clients** as the ecosystem grows

---

## Features

### AI Content Management
| Capability | Description |
|------------|-------------|
| **Posts & Pages** | Create, edit, delete with natural language |
| **Media** | Upload images with automatic responsive variants |
| **Menus** | Configure navigation including dropdowns |
| **Tags** | Organize content with tag management |
| **Deploy** | Render and publish to any configured server |

### Visual Status Indicator
The Publii sidebar shows real-time MCP activity:
- **Green** - AI connected and ready
- **Red** - Database write in progress
- **Yellow** - Idle

### Full Publii Compatibility
All original features preserved:
- Visual editors (TinyMCE, Block Editor, Markdown)
- Theme customization
- Multiple deploy targets (SFTP, S3, GitHub Pages, Netlify, etc.)
- SEO tools & responsive images

---

## Installation

### 1. Download

| Platform | Format |
|----------|--------|
| Linux | `.deb`, `.AppImage` |
| Windows | Coming soon |
| macOS | Coming soon |

### 2. Enable MCP

1. Open Publii → **Settings** → **Experimental Features**
2. Enable **MCP Integration**

### 3. Configure Your AI Assistant

Add to your MCP configuration:

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

**Configuration locations:**
- Claude Desktop: `~/.config/Claude/claude_desktop_config.json`
- Claude Code: `claude mcp add publii node /path/to/cli.js`

---

## MCP Tools Reference

### Sites
- `list_sites` - List all available sites
- `get_site_config` - Get site configuration details

### Content
- `list_posts` / `get_post` / `create_post` / `update_post` / `delete_post`
- `list_pages` / `get_page` / `create_page` / `update_page` / `delete_page`
- `list_tags` / `get_tag` / `create_tag` / `update_tag` / `delete_tag`

### Media
- `list_media` - Browse media files
- `upload_image` - Upload with responsive image generation
- `upload_file` - Upload documents (PDF, etc.)
- `delete_media` / `get_media_info`

### Navigation
- `get_menu` / `set_menu` / `add_menu_item` / `remove_menu_item` / `clear_menu`

### Publishing
- `render_site` - Generate static HTML
- `deploy_site` - Upload to configured server
- `get_sync_status` - Check deployment status

---

## Use Cases

**Content Creation**
> "Create a blog post about renewable energy with an introduction and three main sections"

**Site Maintenance**
> "Update all posts tagged 'news' to include a disclaimer footer"

**Website Migration**
> "Clone the structure and content from example.com to my Publii site"

**Bulk Operations**
> "Generate 10 placeholder posts for testing the theme"

---

## Development

### Building from Source

```bash
git clone https://github.com/your-repo/Publii-fork.git
cd Publii-fork
npm install && cd app && npm install && cd ..
npm run prod && npm run prepare-editor

# Development
npm run build2

# Production packages
npx electron-builder build --linux deb AppImage
```

### Project Structure

```
app/back-end/mcp/
├── cli.js              # Standalone MCP server entry point
├── server.js           # MCP protocol implementation
├── events/mcp.js       # IPC handlers for UI integration
├── helpers/            # Shared utilities
└── tools/              # Tool implementations
    ├── sites.js        # Site management
    ├── posts.js        # Post CRUD operations
    ├── pages.js        # Page CRUD operations
    ├── tags.js         # Tag management
    ├── menus.js        # Menu configuration
    ├── media.js        # Media handling
    └── deploy.js       # Render & deployment
```

---

## Why MCP?

| Benefit | Description |
|---------|-------------|
| **Open Standard** | Not locked to any single AI provider |
| **Secure** | AI operates within defined tool boundaries |
| **Transparent** | All operations logged and visible |
| **Extensible** | Easy to add new capabilities |

---

## Credits

This project builds upon:
- **[Publii](https://getpublii.com/)** by TidyCustoms - The excellent static site CMS
- **[Model Context Protocol](https://modelcontextprotocol.io/)** by Anthropic - The AI integration standard

---

## License

Copyright (c) 2025 TidyCustoms (original Publii)
MCP Integration by Johan den Hollander

[GNU General Public License v3.0](LICENSE)
