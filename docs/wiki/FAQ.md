# FAQ

**Does it run commands on my array?**
No. It never connects to a storage system. It returns text; you run it.

**Do I need CCI installed to use it?**
Not to use the server. You need CCI, a running HORCM instance and an account on the array to run the commands it gives you.

**Which arrays does it know?**
The command set comes from the CCI Command Reference. Per-model limits cover VSP One Block 24/26/28, the VSP 5000 series and VSP E590/E790/E990/E1090. Without a model, values are checked against the widest range of any model.

**Does it support replication (`paircreate`, `pairdisplay`, ...)?**
Not yet. Those are separate CCI commands, not `raidcom`. It does build the `raidcom` side of replication setup, such as device and copy groups (see the `create-copy-group` recipe).

**What about mainframe?**
Yes: CU:LDEV IDs (`dd:0f`), ranges like `dd:00-dd:0f`, `-emulation 3390-V`, SSIDs, and the `create-mainframe-pool` recipe.

**Is it an official Hitachi Vantara tool?**
No. It's an independent community project under the MIT licence.

**Does it contain the Hitachi manuals?**
No. The catalogue holds structured facts (command and option names, value shapes, limits and the command lines of examples), not the manuals' text.

**Is my data stored?**
No. See [[Security and Privacy]].

**Can I use it with ChatGPT, Gemini or a local model?**
With any client that supports MCP. Over stdio for local clients, or Streamable HTTP for remote ones.

**Why not just ask the model to write raidcom commands?**
See [[Why MCP instead of RAG]].
