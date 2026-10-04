/**
 * Removes circular $ref references from a schema by expanding them to a limited depth.
 * This prevents stack overflow in yaml-language-server's schema matching.
 */
export function fixCircularRefsInSchema(schema: any, maxDepth = 3): any {
  const visited = new Map<string, number>();

  const fixRefs = (obj: any, path: string, currentDepth: number): any => {
    if (typeof obj !== "object" || obj === null) {
      return obj;
    }

    // Track how many times we've seen this reference path
    const depthAtPath = visited.get(path) || 0;
    if (depthAtPath >= maxDepth) {
      // Stop resolving at max depth - return a simple schema instead
      return { type: "object", description: "(Nested structure - see schema documentation)" };
    }

    visited.set(path, depthAtPath + 1);

    if (Array.isArray(obj)) {
      const result = obj.map((item, index) => fixRefs(item, `${path}[${index}]`, currentDepth));
      visited.set(path, depthAtPath);
      return result;
    }

    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === "$ref" && typeof value === "string") {
        // Check if this is a self-reference
        const refPath = value.replace("#/definitions/", "");
        if (path.includes(refPath)) {
          // Self-reference detected - limit depth
          if (currentDepth >= maxDepth) {
            result[key] = value; // Keep the ref but we won't expand it further
            continue;
          }
        }
      }
      result[key] = fixRefs(value, `${path}.${key}`, currentDepth + 1);
    }

    visited.set(path, depthAtPath);
    return result;
  };

  return fixRefs(schema, "root", 0);
}
