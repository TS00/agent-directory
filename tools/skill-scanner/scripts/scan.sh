#!/bin/bash
# Skill Scanner - Security Audit Tool
# Built by Kit 🎻

set -e

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

CRITICAL_COUNT=0
WARNING_COUNT=0
INFO_COUNT=0

TARGET="$1"
TEMP_DIR=""

if [ -z "$TARGET" ]; then
    echo "Usage: $0 <skill-path-or-github-url>"
    exit 1
fi

# Clone if GitHub URL
if [[ "$TARGET" == http* ]]; then
    TEMP_DIR=$(mktemp -d)
    echo -e "${BLUE}[*] Cloning repository...${NC}"
    git clone --depth 1 "$TARGET" "$TEMP_DIR" 2>/dev/null
    TARGET="$TEMP_DIR"
fi

if [ ! -d "$TARGET" ]; then
    echo -e "${RED}[!] Target directory not found: $TARGET${NC}"
    exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║           SKILL SCANNER — Security Audit                 ║"
echo "║                   Built by Kit 🎻                        ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo -e "${BLUE}[*] Scanning: $TARGET${NC}"
echo ""

# Function to scan files
scan_pattern() {
    local pattern="$1"
    local description="$2"
    local severity="$3"
    local results
    
    results=$(grep -rn --include="*.js" --include="*.ts" --include="*.sh" --include="*.py" --include="*.md" -E "$pattern" "$TARGET" 2>/dev/null || true)
    
    if [ -n "$results" ]; then
        case $severity in
            "CRITICAL")
                echo -e "${RED}[CRITICAL] $description${NC}"
                CRITICAL_COUNT=$((CRITICAL_COUNT + 1))
                ;;
            "WARNING")
                echo -e "${YELLOW}[WARNING] $description${NC}"
                WARNING_COUNT=$((WARNING_COUNT + 1))
                ;;
            "INFO")
                echo -e "${BLUE}[INFO] $description${NC}"
                INFO_COUNT=$((INFO_COUNT + 1))
                ;;
        esac
        echo "$results" | head -5 | while read -r line; do
            echo "    $line"
        done
        if [ $(echo "$results" | wc -l) -gt 5 ]; then
            echo "    ... and $(($(echo "$results" | wc -l) - 5)) more"
        fi
        echo ""
    fi
}

echo "═══════════════════════════════════════════════════════════"
echo " CRITICAL CHECKS"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Critical patterns
scan_pattern "0x[a-fA-F0-9]{64}" "Possible private key detected" "CRITICAL"
scan_pattern "(sk_live|sk_test|api_key|apikey|secret_key|private_key)\s*[:=]\s*['\"][^'\"]+['\"]" "Hardcoded API key/secret" "CRITICAL"
scan_pattern "eval\s*\(" "Dynamic code execution (eval)" "CRITICAL"
scan_pattern "new\s+Function\s*\(" "Dynamic function constructor" "CRITICAL"
scan_pattern "(webhook\.site|requestbin|pipedream|pastebin\.com|hastebin)" "Suspicious exfiltration domain" "CRITICAL"
scan_pattern "atob\s*\(|btoa\s*\(|Buffer\.from\([^,]+,\s*['\"]base64['\"]" "Base64 encoding (possible obfuscation)" "CRITICAL"
scan_pattern "process\.env\.[A-Z_]+.*fetch|process\.env\.[A-Z_]+.*axios|process\.env\.[A-Z_]+.*http" "Env var used in network request" "CRITICAL"

echo "═══════════════════════════════════════════════════════════"
echo " WARNING CHECKS"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Warning patterns
scan_pattern "process\.env" "Environment variable access" "WARNING"
scan_pattern "fs\.(writeFile|appendFile|createWriteStream)" "File system write operations" "WARNING"
scan_pattern "child_process|spawn\s*\(|exec\s*\(" "Shell command execution" "WARNING"
scan_pattern "\.\./" "Parent directory traversal" "WARNING"
scan_pattern "(curl|wget)\s+.*\|.*sh" "Piped download to shell" "WARNING"
scan_pattern "chmod\s+\+x|chmod\s+777" "Permission modifications" "WARNING"

echo "═══════════════════════════════════════════════════════════"
echo " INFO CHECKS"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Info patterns
scan_pattern "(fetch|axios|http\.request|https\.request)\s*\(" "External network requests" "INFO"
scan_pattern "fs\.(readFile|readFileSync|readdir)" "File system read operations" "INFO"
scan_pattern "require\s*\(['\"]child_process" "Child process module imported" "INFO"

echo "═══════════════════════════════════════════════════════════"
echo " SUMMARY"
echo "═══════════════════════════════════════════════════════════"
echo ""

if [ $CRITICAL_COUNT -gt 0 ]; then
    echo -e "${RED}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ⚠️  RISK LEVEL: CRITICAL — DO NOT INSTALL              ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${RED}Critical issues: $CRITICAL_COUNT${NC}"
    echo -e "  ${YELLOW}Warnings: $WARNING_COUNT${NC}"
    echo -e "  ${BLUE}Info: $INFO_COUNT${NC}"
    echo ""
    echo "  This skill contains patterns commonly associated with"
    echo "  malicious code. Manual review strongly recommended."
elif [ $WARNING_COUNT -gt 0 ]; then
    echo -e "${YELLOW}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║  ⚡ RISK LEVEL: WARNING — Review before installing      ║${NC}"
    echo -e "${YELLOW}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${YELLOW}Warnings: $WARNING_COUNT${NC}"
    echo -e "  ${BLUE}Info: $INFO_COUNT${NC}"
    echo ""
    echo "  This skill has patterns that warrant review."
    echo "  May be legitimate, but verify the use cases."
else
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  ✅ RISK LEVEL: CLEAN — No obvious issues detected       ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${BLUE}Info: $INFO_COUNT${NC}"
    echo ""
    echo "  No critical or warning patterns found."
    echo "  Standard code review still recommended."
fi

echo ""

# Cleanup temp dir if we cloned
if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
fi
