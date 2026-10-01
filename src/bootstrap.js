import dns from "node:dns";

/*
 * Node's c-ares DNS resolver can fail to resolve MongoDB Atlas SRV records
 * through the machine's local DNS configuration.
 *
 * Configure known public resolvers before loading the application so the
 * MongoDB driver can resolve the mongodb+srv connection string reliably.
 */
const bootstrapDnsServers = [
    "8.8.8.8",
    "1.1.1.1",
];

dns.setServers(
    bootstrapDnsServers,
);

console.log(
    "Bootstrap DNS servers:",
    dns.getServers(),
);

/*
 * This MUST be a dynamic import.
 *
 * A static `import "./server.js"` is evaluated before this module body runs,
 * which would allow MongoDB startup to happen before dns.setServers().
 */
await import(
    "./server.js"
);