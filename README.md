# PHP Magic Number Detector

VS Code extension for integrating [phpmnd](https://github.com/povils/phpmnd) into your development workflow.

## Features

- Automatically detects magic numbers in PHP files
- Inline diagnostics and Problems panel integration
- Runs on file open and save
- Bundled with phpmnd.phar

## Requirements

- PHP installed and available in PATH

## Usage

The extension activates automatically when opening PHP files. To manually trigger analysis:

- Command Palette: `PHPMND: Check for Magic Numbers`

View detailed output in the "PHP Magic Number Detector" output channel

## Configuration

```json
{
  "phpmnd.ignoreNumbers": ["0", "1"],
  "phpmnd.ignoreStrings": [],
  "phpmnd.extensions": "all"
}
```

**Options:**

- `phpmnd.ignoreNumbers` - Array of numbers to ignore
- `phpmnd.ignoreStrings` - Array of string patterns to ignore
- `phpmnd.extensions` - Code constructs to analyze (default: `"all"`)
  - Available: `return`, `condition`, `switch_case`, `assign`, `operation`, `argument`, `array`, `default_parameter`,
    `property`, `all`
  - Combine multiple: `"return,condition,assign"`
  - Exclude with minus: `"all,-array"`

For issues, check the "PHP Magic Number Detector" output channel for detailed error messages

## License

[MIT License](LICENSE)
