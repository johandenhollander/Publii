# Publii MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that gives AI assistants like Claude access to your Publii CMS.

## What can you do with it?

With the Publii MCP server, Claude can:

- **Manage sites** - Create, configure, and delete sites
- **Create content** - Write, edit, and delete posts and pages
- **Manage tags** - Create and organize tags
- **Configure menus** - Set up navigation menus
- **Upload media** - Add images and files

All without having Publii open!

## Requirements

- **Node.js 18+** - [Download here](https://nodejs.org/)
- **Publii** - Installed with at least one site
- **Claude Desktop** or **Claude Code** - As MCP client

## Installation

### Step 1: Clone the repository

```bash
git clone https://github.com/[user]/Publii.git
cd Publii
```

### Step 2: Install dependencies

```bash
npm install
cd app && npm install && cd ..
```

### Step 3: Note the path to the MCP server

```
/path/to/Publii/app/back-end/mcp/cli.js
```

## Configuration

### Claude Desktop

Edit the configuration file:

**Linux:** `~/.config/Claude/claude_desktop_config.json`
**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "publii": {
      "command": "node",
      "args": ["/path/to/Publii/app/back-end/mcp/cli.js"]
    }
  }
}
```

### Claude Code

Add to your MCP settings or use the CLI:

```bash
claude mcp add publii node /path/to/Publii/app/back-end/mcp/cli.js
```

## Available Tools

### Site Management
| Tool | Description |
|------|-------------|
| `list_sites` | List all Publii sites |
| `get_site_config` | Get site configuration |
| `update_site_config` | Update site settings |
| `create_site` | Create a new site |
| `delete_site` | Delete a site |

### Posts
| Tool | Description |
|------|-------------|
| `list_posts` | List posts (with filters) |
| `get_post` | Get a specific post |
| `create_post` | Create a new post |
| `update_post` | Edit a post |
| `delete_post` | Delete a post |

### Pages
| Tool | Description |
|------|-------------|
| `list_pages` | List all pages |
| `get_page` | Get a specific page |
| `create_page` | Create a new page |
| `update_page` | Edit a page |
| `delete_page` | Delete a page |

### Tags
| Tool | Description |
|------|-------------|
| `list_tags` | List all tags |
| `create_tag` | Create a new tag |

### Menus
| Tool | Description |
|------|-------------|
| `get_menu` | Get menu configuration |
| `set_menu` | Set menu |
| `add_page_to_menu` | Add page to menu |

### Media
| Tool | Description |
|------|-------------|
| `list_media` | List media files |
| `upload_media` | Upload a file |

### Authors
| Tool | Description |
|------|-------------|
| `list_authors` | List all authors |
| `get_author` | Get author details |

## Examples

### Ask Claude to show your sites

```
What Publii sites do I have?
```

### Have Claude write a blog post

```
Write a blog post about the benefits of static site generators
and publish it on my site "my-blog"
```

### Create a new page

```
Create an "About Us" page on site "company-site" with information
about our team and mission
```

### Organize content with tags

```
Create tags for "technology", "tutorial" and "news" on my blog
```

## Publii UI Integration

If you're running Publii-fork, you can see MCP activity live in the app:

1. Go to **Settings > Experimental Features**
2. Enable **MCP Integration**
3. View the **MCP Activity** page in the menu

You'll see:
- Connected MCP clients (Claude Desktop, Claude Code, etc.)
- Real-time activity log
- Automatic data refresh on MCP changes

## Troubleshooting

### "Cannot find module" error

Make sure dependencies are installed:

```bash
cd /path/to/Publii/app
npm install
```

### "Database is locked" error

This can happen when Publii and the MCP server access the database simultaneously.
The MCP server has a built-in 500ms delay to prevent this.

### Claude doesn't see the tools

1. Restart Claude Desktop/Code after configuration changes
2. Verify the path to `cli.js` is correct
3. Test the server manually: `node /path/to/cli.js`

### Wrong Publii data directory

The MCP server automatically looks in:
- Linux: `~/Documents/Publii/`
- macOS: `~/Documents/Publii/`
- Windows: `Documents\Publii\`

## Editor Support

The MCP server supports all three Publii editors:

| Editor | Content Format |
|--------|----------------|
| **WYSIWYG (TinyMCE)** | HTML |
| **Block Editor** | JSON array of blocks |
| **Markdown** | Plain text markdown |

When creating posts, you can specify the editor:

```
Create a post with the markdown editor on site "my-blog"
```

## License

GPL-3.0 - Same license as Publii

## Links

- [Publii Website](https://getpublii.com/)
- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [Claude Desktop](https://claude.ai/download)
