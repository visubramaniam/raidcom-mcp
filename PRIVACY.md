# Privacy

raidcom-mcp is a community project, not an official Hitachi Vantara product. This page covers the software and the public instance at `https://raidcom-mcp.onrender.com`.

## Running it yourself

When you run raidcom-mcp on your own computer or server (npm, the standalone packages, the Claude Desktop extension, the Claude Code plugin or Docker), it collects nothing and sends nothing anywhere. It makes no network requests, keeps no data between requests and has no telemetry.

## The public instance

The hosted endpoint builds commands from what your AI assistant sends it and returns them. It needs no account and sets no cookies.

- **What it receives:** the tool requests your assistant sends, such as a command name, options, IDs, port names, host group names or WWNs, and the usual connection data (your IP address and HTTP headers).
- **What it keeps:** nothing. Requests are processed in memory and discarded when the response is sent. It has no database and stores no files.
- **What it logs:** only refused requests (for example over the rate limit or with a wrong token): the time, the path, your IP address and the reason. Never the request's content. These logs are kept by the hosting provider for its standard retention period.
- **Who else handles the traffic:** the service runs on [Render](https://render.com/privacy), which sits behind [Cloudflare](https://www.cloudflare.com/privacypolicy/). Both process connection data (such as IP addresses) under their own privacy policies.
- **Through mcprush:** requests that reach the server through the mcprush marketplace are also handled by mcprush under [its policy](https://mcprush.com).

What you type to your AI assistant is handled by that assistant's provider (for example Anthropic, GitHub or Microsoft) under their policies; this server only sees the tool requests the assistant makes.

Don't send secrets. The server never needs passwords or tokens for your storage systems, and scripts it builds read credentials from your own shell.

## Contact

Questions or requests: open an issue at https://github.com/visubramaniam/raidcom-mcp/issues, or report something sensitive privately through **Security → Report a vulnerability** on the repository.

Changes to this page are recorded in the repository's history.
