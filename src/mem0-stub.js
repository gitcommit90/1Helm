// Stands in for every package that Mem0 can load but 1HC never uses (wrangler alias in both wrangler files). It is never called.
export default class Unused { constructor() { throw new Error("This package is not available in the Worker."); } }
