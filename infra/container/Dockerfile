# WireGuard VPN Container Base Image
# Based on Alpine Linux for minimal size and security
FROM alpine:3.19

# Install required packages
RUN apk add --no-cache \
    wireguard-tools \
    iptables \
    iproute2 \
    bash \
    curl \
    jq \
    openssl \
    && rm -rf /var/cache/apk/*

# Create necessary directories
RUN mkdir -p /etc/wireguard /var/log/wireguard /scripts

# Copy configuration scripts
COPY scripts/entrypoint.sh /scripts/entrypoint.sh
COPY scripts/generate-config.sh /scripts/generate-config.sh
COPY scripts/health-check.sh /scripts/health-check.sh

# Make scripts executable
RUN chmod +x /scripts/*.sh

# Set up WireGuard configuration directory
WORKDIR /etc/wireguard

# Expose WireGuard port
EXPOSE 51820/udp

# Set entrypoint
ENTRYPOINT ["/scripts/entrypoint.sh"]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD /scripts/health-check.sh
