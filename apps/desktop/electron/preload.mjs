import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("redouDesktop", {
  platform: process.platform
});

