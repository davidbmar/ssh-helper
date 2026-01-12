#!/usr/bin/env python3
"""
SSH Helper - Dynamic IP Whitelist Manager for EC2 Security Groups
"""

import argparse
import sys
import json
import yaml
from pathlib import Path
from datetime import datetime, timedelta
import boto3
from botocore.exceptions import ClientError
import requests

# Configuration
CONFIG_FILE = Path(__file__).parent / 'config.yml'
DEFAULT_CONFIG = {
    'aws': {
        'region': 'us-east-1',
        'security_group_id': ''
    },
    'defaults': {
        'default_duration': '24h',
        'max_duration': '168h'
    },
    'logging': {
        'audit_log_path': './logs/audit.log'
    }
}

class Colors:
    """ANSI color codes for terminal output"""
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    RED = '\033[0;31m'
    BLUE = '\033[0;34m'
    NC = '\033[0m'  # No Color

def log_success(message):
    """Print success message in green"""
    print(f"{Colors.GREEN}✓{Colors.NC} {message}")

def log_error(message):
    """Print error message in red"""
    print(f"{Colors.RED}✗{Colors.NC} {message}", file=sys.stderr)

def log_info(message):
    """Print info message in blue"""
    print(f"{Colors.BLUE}ℹ{Colors.NC} {message}")

def log_warning(message):
    """Print warning message in yellow"""
    print(f"{Colors.YELLOW}⚠{Colors.NC}  {message}")

def load_config():
    """Load configuration from config.yml"""
    if not CONFIG_FILE.exists():
        log_warning(f"Config file not found: {CONFIG_FILE}")
        log_info("Using default configuration. Create config.yml to customize.")
        return DEFAULT_CONFIG

    with open(CONFIG_FILE, 'r') as f:
        return yaml.safe_load(f)

def parse_duration(duration_str):
    """Parse duration string like '24h', '7d', '30m' to timedelta"""
    unit = duration_str[-1]
    value = int(duration_str[:-1])

    if unit == 'h':
        return timedelta(hours=value)
    elif unit == 'd':
        return timedelta(days=value)
    elif unit == 'm':
        return timedelta(minutes=value)
    else:
        raise ValueError(f"Invalid duration unit: {unit}. Use h (hours), d (days), or m (minutes)")

def get_current_ip():
    """Detect current public IP address"""
    try:
        # Try multiple services for reliability
        services = [
            'https://api.ipify.org',
            'https://ifconfig.me/ip',
            'https://icanhazip.com'
        ]

        for service in services:
            try:
                response = requests.get(service, timeout=5)
                if response.status_code == 200:
                    ip = response.text.strip()
                    return ip
            except:
                continue

        log_error("Could not detect IP from any service")
        return None
    except Exception as e:
        log_error(f"Failed to detect IP: {e}")
        return None

def get_ec2_client(region):
    """Create EC2 boto3 client"""
    return boto3.client('ec2', region_name=region)

def add_ip_to_security_group(ec2_client, sg_id, ip_address, description):
    """Add IP address to security group for SSH access"""
    try:
        # Add /32 for single IP
        cidr = f"{ip_address}/32"

        response = ec2_client.authorize_security_group_ingress(
            GroupId=sg_id,
            IpPermissions=[
                {
                    'IpProtocol': 'tcp',
                    'FromPort': 22,
                    'ToPort': 22,
                    'IpRanges': [
                        {
                            'CidrIp': cidr,
                            'Description': description
                        }
                    ]
                }
            ]
        )

        return True
    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == 'InvalidPermission.Duplicate':
            log_warning(f"IP {ip_address} already exists in security group")
            return True
        else:
            log_error(f"AWS Error: {e.response['Error']['Message']}")
            return False
    except Exception as e:
        log_error(f"Failed to add IP: {e}")
        return False

def remove_ip_from_security_group(ec2_client, sg_id, ip_address):
    """Remove IP address from security group"""
    try:
        cidr = f"{ip_address}/32"

        response = ec2_client.revoke_security_group_ingress(
            GroupId=sg_id,
            IpPermissions=[
                {
                    'IpProtocol': 'tcp',
                    'FromPort': 22,
                    'ToPort': 22,
                    'IpRanges': [{'CidrIp': cidr}]
                }
            ]
        )

        return True
    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == 'InvalidPermission.NotFound':
            log_warning(f"IP {ip_address} not found in security group")
            return False
        else:
            log_error(f"AWS Error: {e.response['Error']['Message']}")
            return False
    except Exception as e:
        log_error(f"Failed to remove IP: {e}")
        return False

def list_security_group_rules(ec2_client, sg_id):
    """List all SSH rules in security group"""
    try:
        response = ec2_client.describe_security_groups(GroupIds=[sg_id])

        if not response['SecurityGroups']:
            log_error(f"Security group {sg_id} not found")
            return []

        sg = response['SecurityGroups'][0]
        ssh_rules = []

        for permission in sg.get('IpPermissions', []):
            if permission.get('IpProtocol') == 'tcp' and \
               permission.get('FromPort') == 22 and \
               permission.get('ToPort') == 22:

                for ip_range in permission.get('IpRanges', []):
                    ssh_rules.append({
                        'cidr': ip_range['CidrIp'],
                        'description': ip_range.get('Description', 'No description')
                    })

        return ssh_rules
    except ClientError as e:
        log_error(f"AWS Error: {e.response['Error']['Message']}")
        return []
    except Exception as e:
        log_error(f"Failed to list rules: {e}")
        return []

def audit_log(action, ip_address, user, details=None):
    """Write audit log entry"""
    config = load_config()
    log_path = Path(config['logging']['audit_log_path'])

    # Create logs directory if it doesn't exist
    log_path.parent.mkdir(parents=True, exist_ok=True)

    entry = {
        'timestamp': datetime.utcnow().isoformat(),
        'action': action,
        'ip_address': ip_address,
        'user': user,
        'details': details or {}
    }

    with open(log_path, 'a') as f:
        f.write(json.dumps(entry) + '\n')

def cmd_add(args):
    """Add IP to security group"""
    config = load_config()

    # Get security group ID
    sg_id = config['aws']['security_group_id']
    if not sg_id:
        log_error("Security group ID not configured. Set in config.yml")
        return 1

    # Get IP address
    ip_address = args.ip
    if not ip_address:
        log_info("Detecting your public IP address...")
        ip_address = get_current_ip()
        if not ip_address:
            log_error("Could not detect IP. Specify with --ip")
            return 1
        log_info(f"Detected IP: {ip_address}")

    # Parse duration
    duration_str = args.duration or config['defaults']['default_duration']
    duration = parse_duration(duration_str)
    expiry = datetime.utcnow() + duration

    # Build description
    user = args.user or 'unknown'
    description = f"{user} | Expires: {expiry.strftime('%Y-%m-%d %H:%M')} UTC"
    if args.description:
        description += f" | {args.description}"

    # Add to security group
    log_info(f"Adding {ip_address} to security group {sg_id}...")
    ec2_client = get_ec2_client(config['aws']['region'])

    if add_ip_to_security_group(ec2_client, sg_id, ip_address, description):
        log_success(f"Added {ip_address} to security group {sg_id}")
        log_success(f"SSH access granted until {expiry.strftime('%Y-%m-%d %H:%M')} UTC")

        # Audit log
        audit_log('add', ip_address, user, {
            'duration': duration_str,
            'expiry': expiry.isoformat(),
            'description': args.description
        })

        return 0
    else:
        return 1

def cmd_remove(args):
    """Remove IP from security group"""
    config = load_config()

    sg_id = config['aws']['security_group_id']
    if not sg_id:
        log_error("Security group ID not configured")
        return 1

    # Get IP address
    ip_address = args.ip
    if args.me or not ip_address:
        log_info("Detecting your public IP address...")
        ip_address = get_current_ip()
        if not ip_address:
            log_error("Could not detect IP. Specify with --ip")
            return 1
        log_info(f"Detected IP: {ip_address}")

    # Remove from security group
    log_info(f"Removing {ip_address} from security group {sg_id}...")
    ec2_client = get_ec2_client(config['aws']['region'])

    if remove_ip_from_security_group(ec2_client, sg_id, ip_address):
        log_success(f"Removed {ip_address} from security group")

        # Audit log
        audit_log('remove', ip_address, args.user or 'unknown')

        return 0
    else:
        return 1

def cmd_list(args):
    """List all IPs in security group"""
    config = load_config()

    sg_id = config['aws']['security_group_id']
    if not sg_id:
        log_error("Security group ID not configured")
        return 1

    log_info(f"Listing SSH rules in security group {sg_id}...")
    ec2_client = get_ec2_client(config['aws']['region'])

    rules = list_security_group_rules(ec2_client, sg_id)

    if not rules:
        log_info("No SSH rules found")
        return 0

    print(f"\n{Colors.BLUE}SSH Access Rules:{Colors.NC}")
    print(f"{'-' * 80}")

    for rule in rules:
        ip = rule['cidr'].replace('/32', '')
        description = rule['description']
        print(f"  {Colors.GREEN}•{Colors.NC} {ip:15s} - {description}")

    print(f"{'-' * 80}")
    print(f"Total rules: {len(rules)}\n")

    return 0

def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description='SSH Helper - Manage EC2 security group rules for SSH access'
    )
    subparsers = parser.add_subparsers(dest='command', help='Command to execute')

    # Add command
    add_parser = subparsers.add_parser('add', help='Add IP to security group')
    add_parser.add_argument('--ip', help='IP address (auto-detected if not specified)')
    add_parser.add_argument('--duration', help='Access duration (e.g., 24h, 7d)')
    add_parser.add_argument('--user', help='Username for audit log')
    add_parser.add_argument('--description', help='Additional description')

    # Remove command
    remove_parser = subparsers.add_parser('remove', help='Remove IP from security group')
    remove_parser.add_argument('--ip', help='IP address to remove')
    remove_parser.add_argument('--me', action='store_true', help='Remove current IP')
    remove_parser.add_argument('--user', help='Username for audit log')

    # List command
    list_parser = subparsers.add_parser('list', help='List all SSH rules')

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 1

    # Execute command
    if args.command == 'add':
        return cmd_add(args)
    elif args.command == 'remove':
        return cmd_remove(args)
    elif args.command == 'list':
        return cmd_list(args)
    else:
        parser.print_help()
        return 1

if __name__ == '__main__':
    sys.exit(main())
