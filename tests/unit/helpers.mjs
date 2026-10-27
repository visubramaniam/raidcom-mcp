import { Catalog } from "../../dist/catalog.js";

export const catalog = new Catalog(new URL("../../spec/raidcom-catalog.json", import.meta.url).pathname, new URL("../../spec/limits.json", import.meta.url).pathname);
