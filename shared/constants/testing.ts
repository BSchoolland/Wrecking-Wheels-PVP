export let CONTRAPTION_DEBUG = false;

export let CONTRAPTION_STATIC_DEBUG = false;

export let SIMULATE_POOR_NETWORK = true;

// latency, packet loss percent, packet variability
export let POOR_NETWORK_CONSTANTS = {
    latency: 100, // ms
    packetLossPercent: 0.1, // out of 1
    packetVariability: 50, // ms
}