#!/bin/bash
set -e

# Check if pg-schema-diff is installed
if ! command -v pg-schema-diff &> /dev/null
then
    echo "Error: pg-schema-diff is not installed."
    echo "Please install it using: go install github.com/stripe/pg-schema-diff/cmd/pg-schema-diff@latest"
    exit 1
fi

# Get the directory of the script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Navigate to the project root directory (assuming it's one level up from the scripts directory)
PROJECT_ROOT="$SCRIPT_DIR/.."

# Set the path to the SQL directory
SQL_DIR="$PROJECT_ROOT/sql"

# Set the path to the schema file
SCHEMA_FILE="$SQL_DIR/schema.sql"

# Check if the schema file exists
if [ ! -f "$SCHEMA_FILE" ]; then
    echo "Error: schema.sql file not found in $SQL_DIR"
    exit 1
fi

# Apply the schema to the database
echo "Applying schema to the database..."
pg-schema-diff apply --schema-file "$SCHEMA_FILE"

echo "Database initialization completed successfully."
