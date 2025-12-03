export let CONTRAPTION_DEBUG = false;

export let CONTRAPTION_STATIC_DEBUG = false;

export let SIMULATE_POOR_NETWORK = false;

// latency, packet loss percent, packet variability
export let POOR_NETWORK_CONSTANTS = {
    latency: 80, // ms
    packetLossPercent: 0.02, // out of 1
    packetVariability: 10, // ms
}