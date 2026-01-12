# SSH Helper - Dynamic IP Whitelist Manager

Manage EC2 security group rules to grant temporary SSH access based on dynamic IP addresses.

## Overview

SSH Helper is a CLI tool that allows developers to quickly whitelist their current IP address for SSH access to EC2 instances. Perfect for teams working from home/coffee shops with dynamic IPs.

## Features

- 🔐 **Dynamic IP Whitelisting** - Add your current IP to security group
- ⏰ **Time-Limited Access** - Automatically expire rules after specified duration
- 📋 **IP Management** - List, add, and remove IP rules
- 🔍 **Audit Logging** - Track who added what IP and when
- 🚀 **Simple CLI** - Easy-to-use command-line interface
- ☁️ **AWS Native** - Uses boto3 with IAM role credentials

## Architecture

```
Developer (Dynamic IP)
     ↓
ssh-helper CLI
     ↓
AWS API (boto3)
     ↓
EC2 Security Group Rules
     ↓
EC2 Instance (SSH Port 22)
```

## Quick Start

### Installation

```bash
# Clone repository
git clone https://github.com/YOUR_USERNAME/ssh-helper.git
cd ssh-helper

# Install dependencies
pip install -r requirements.txt

# Or use npm for Node.js version
npm install
```

### Basic Usage

```bash
# Add your current IP for 24 hours
./ssh-helper.py add --duration=24h

# Add specific IP
./ssh-helper.py add --ip=203.0.113.5 --user=john

# List all whitelisted IPs
./ssh-helper.py list

# Remove IP
./ssh-helper.py remove --ip=203.0.113.5

# Remove your current IP
./ssh-helper.py remove --me
```

## Configuration

Create `config.yml`:

```yaml
aws:
  region: us-east-1
  security_group_id: sg-0123456789abcdef0

defaults:
  default_duration: 24h
  max_duration: 168h  # 7 days

logging:
  audit_log_path: ./logs/audit.log
  cloudwatch_log_group: /ssh-helper/audit
```

## IAM Permissions

The tool requires these IAM permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeSecurityGroups",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:RevokeSecurityGroupIngress",
        "ec2:DescribeSecurityGroupRules"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/ssh-helper/*"
    }
  ]
}
```

## Commands

### Add IP Address

```bash
# Add current IP (auto-detected)
./ssh-helper.py add

# Add specific IP
./ssh-helper.py add --ip=203.0.113.5

# Add with custom duration
./ssh-helper.py add --duration=48h

# Add with description
./ssh-helper.py add --user=john --description="John's home office"
```

### List IP Addresses

```bash
# List all IPs
./ssh-helper.py list

# List with expiry times
./ssh-helper.py list --show-expiry

# List only your IPs
./ssh-helper.py list --me
```

### Remove IP Address

```bash
# Remove specific IP
./ssh-helper.py remove --ip=203.0.113.5

# Remove current IP
./ssh-helper.py remove --me

# Remove all expired IPs
./ssh-helper.py cleanup
```

## Example Workflow

```bash
# Developer starts work from home
$ ./ssh-helper.py add --duration=8h
✓ Added 203.0.113.5 to security group sg-abc123
✓ SSH access granted until 2026-01-12 17:00 UTC
✓ You can now SSH to EC2 instances

# Connect to instance
$ ssh ubuntu@ec2-instance.compute.amazonaws.com
# Works!

# At end of day, remove access
$ ./ssh-helper.py remove --me
✓ Removed 203.0.113.5 from security group
✓ SSH access revoked
```

## Advanced Usage

### Automatic Cleanup

Set up a cron job to remove expired IPs:

```bash
# Add to crontab
0 * * * * /path/to/ssh-helper.py cleanup
```

### Web Interface (Optional)

Start the web UI:

```bash
python server.py
# Access at http://localhost:5000
```

Protected by cognito-auth-gateway in production.

## Deployment

### Option 1: Run locally

```bash
pip install -r requirements.txt
./ssh-helper.py add
```

### Option 2: Deploy behind auth gateway

```bash
# Deploy web UI behind cognito-auth-gateway
# See docs/DEPLOYMENT.md
```

### Option 3: AWS Lambda

```bash
# Deploy as Lambda function
# See terraform/lambda/
```

## Security Considerations

1. **IP Spoofing Prevention**
   - Use trusted IP detection services
   - Validate IP format before adding

2. **Audit Trail**
   - All actions logged to CloudWatch
   - Local audit log with timestamps

3. **Access Control**
   - IAM policies restrict who can modify security groups
   - Web UI protected by authentication gateway

4. **Time Limits**
   - Enforce maximum duration (default: 7 days)
   - Automatic cleanup of expired rules

## Troubleshooting

### Issue: "Permission denied"

**Solution:** Check IAM permissions. EC2 instance needs appropriate role.

```bash
# Check current IAM role
aws sts get-caller-identity

# Verify security group access
aws ec2 describe-security-groups --group-ids sg-abc123
```

### Issue: "IP not detected"

**Solution:** Specify IP manually.

```bash
# Get your IP
curl ifconfig.me

# Add it manually
./ssh-helper.py add --ip=$(curl -s ifconfig.me)
```

### Issue: "Security group not found"

**Solution:** Update `config.yml` with correct security group ID.

```bash
# List security groups
aws ec2 describe-security-groups
```

## Development

### Run Tests

```bash
pytest tests/
```

### Code Structure

```
ssh-helper/
├── ssh-helper.py          # Main CLI tool
├── server.py              # Optional web interface
├── requirements.txt       # Python dependencies
├── config.yml.example     # Example configuration
├── lib/
│   ├── ip_detector.py     # IP detection logic
│   ├── sg_manager.py      # Security group operations
│   └── audit_logger.py    # Audit logging
├── terraform/
│   └── iam.tf            # IAM permissions
└── docs/
    └── DEPLOYMENT.md      # Deployment guide
```

## Related Projects

- [easy-cognito-nginx-gateway-auth](https://github.com/YOUR_USERNAME/easy-cognito-nginx-gateway-auth) - Authentication gateway
- [website-cloner](https://github.com/YOUR_USERNAME/website-cloner) - Website cloning tool

## License

MIT License - see LICENSE file

## Contributing

Pull requests welcome! See CONTRIBUTING.md for guidelines.
