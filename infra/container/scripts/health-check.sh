#!/bin/bash

# WireGuard Health Check Script
# Monitors container health and WireGuard service status

set -e

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] HEALTH: $1" | tee -a /var/log/wireguard/health.log
}

# Check if WireGuard interface exists and is up
check_interface() {
    if ! ip link show wg0 > /dev/null 2>&1; then
        log "ERROR: WireGuard interface wg0 does not exist"
        return 1
    fi
    
    if [[ "$(cat /sys/class/net/wg0/operstate)" != "UP" ]]; then
        log "ERROR: WireGuard interface wg0 is not UP"
        return 1
    fi
    
    log "WireGuard interface status: OK"
    return 0
}

# Check if WireGuard service is running
check_service() {
    if ! wg show > /dev/null 2>&1; then
        log "ERROR: WireGuard service is not running"
        return 1
    fi
    
    # Check if interface is configured
    local interface_info=$(wg show wg0 2>/dev/null || echo "")
    if [[ -z "$interface_info" ]]; then
        log "ERROR: WireGuard interface wg0 is not configured"
        return 1
    fi
    
    log "WireGuard service status: OK"
    return 0
}

# Check network connectivity
check_connectivity() {
    # Test DNS resolution
    if ! nslookup google.com > /dev/null 2>&1; then
        log "WARNING: DNS resolution test failed"
        return 1
    fi
    
    # Test basic internet connectivity
    if ! curl -s --connect-timeout 5 --max-time 10 https://httpbin.org/ip > /dev/null 2>&1; then
        log "WARNING: Internet connectivity test failed"
        return 1
    fi
    
    log "Network connectivity: OK"
    return 0
}

# Check resource usage
check_resources() {
    # Check memory usage
    local mem_usage=$(free -m | awk 'NR==2{printf "%.1f%%", $3*100/$2}')
    local mem_percent=$(echo "$mem_usage" | sed 's/%//')
    
    if (( $(echo "$mem_percent > 90" | bc -l) )); then
        log "WARNING: High memory usage: $mem_usage"
    else
        log "Memory usage: $mem_usage"
    fi
    
    # Check disk usage
    local disk_usage=$(df -h / | awk 'NR==2{print $5}' | sed 's/%//')
    
    if [[ "$disk_usage" -gt 90 ]]; then
        log "WARNING: High disk usage: ${disk_usage}%"
    else
        log "Disk usage: ${disk_usage}%"
    fi
    
    # Check CPU load
    local cpu_load=$(uptime | awk -F'load average:' '{print $2}' | awk '{print $1}' | sed 's/,//')
    log "CPU load: $cpu_load"
}

# Check WireGuard peers and connections
check_peers() {
    local peer_count=$(wg show wg0 peers 2>/dev/null | wc -l)
    log "Active peers: $peer_count"
    
    # Show peer details if any exist
    if [[ "$peer_count" -gt 0 ]]; then
        log "Peer details:"
        wg show wg0 peers 2>/dev/null | while read -r line; do
            log "  $line"
        done
    fi
}

# Check iptables rules
check_iptables() {
    # Check if NAT rules exist
    local nat_rules=$(iptables -t nat -L POSTROUTING -n | grep -c MASQUERADE || echo "0")
    if [[ "$nat_rules" -eq 0 ]]; then
        log "WARNING: NAT rules not configured"
        return 1
    fi
    
    # Check if forwarding rules exist
    local forward_rules=$(iptables -L FORWARD -n | grep -c wg0 || echo "0")
    if [[ "$forward_rules" -eq 0 ]]; then
        log "WARNING: Forwarding rules not configured"
        return 1
    fi
    
    log "Iptables rules: OK"
    return 0
}

# Check configuration files
check_config() {
    local config_files=(
        "/etc/wireguard/wg0.conf"
        "/etc/wireguard/client-template.conf"
    )
    
    for config_file in "${config_files[@]}"; do
        if [[ ! -f "$config_file" ]]; then
            log "ERROR: Configuration file missing: $config_file"
            return 1
        fi
        
        if [[ ! -r "$config_file" ]]; then
            log "ERROR: Configuration file not readable: $config_file"
            return 1
        fi
    done
    
    log "Configuration files: OK"
    return 0
}

# Generate health status report
generate_report() {
    local report_file="/var/log/wireguard/health-report.json"
    local timestamp=$(date -Iseconds)
    
    # Collect health metrics
    local interface_status=$(check_interface > /dev/null && echo "healthy" || echo "unhealthy")
    local service_status=$(check_service > /dev/null && echo "healthy" || echo "unhealthy")
    local connectivity_status=$(check_connectivity > /dev/null && echo "healthy" || echo "unhealthy")
    local config_status=$(check_config > /dev/null && echo "healthy" || echo "unhealthy")
    local iptables_status=$(check_iptables > /dev/null && echo "healthy" || echo "unhealthy")
    
    # Create JSON report
    cat > "$report_file" << EOF
{
    "timestamp": "$timestamp",
    "container_id": "$(hostname)",
    "health_status": {
        "interface": "$interface_status",
        "service": "$service_status",
        "connectivity": "$connectivity_status",
        "configuration": "$config_status",
        "iptables": "$iptables_status"
    },
    "metrics": {
        "memory_usage": "$(free -m | awk 'NR==2{printf "%.1f%%", $3*100/$2}')",
        "disk_usage": "$(df -h / | awk 'NR==2{print $5}')",
        "cpu_load": "$(uptime | awk -F'load average:' '{print $2}' | awk '{print $1}' | sed 's/,//')",
        "active_peers": "$(wg show wg0 peers 2>/dev/null | wc -l)"
    }
}
EOF

    log "Health report generated at $report_file"
}

# Main health check function
main() {
    local exit_code=0
    
    log "Starting health check..."
    
    # Run all health checks
    check_interface || exit_code=1
    check_service || exit_code=1
    check_connectivity || exit_code=1
    check_config || exit_code=1
    check_iptables || exit_code=1
    
    # Resource checks (warnings only)
    check_resources
    check_peers
    
    # Generate health report
    generate_report
    
    if [[ $exit_code -eq 0 ]]; then
        log "Health check completed: HEALTHY"
    else
        log "Health check completed: UNHEALTHY"
    fi
    
    return $exit_code
}

# Run health check
main "$@"
