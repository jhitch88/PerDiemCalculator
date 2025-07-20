# Per Diem Calculator

A comprehensive web application for calculating and tracking travel expenses with automatic per diem rate lookup using the GSA API.

## Features

### 🔐 Secure Authentication
- Single sign-on with environment-based credentials
- Session management to protect API key from rate limiting
- Secure cookie handling with HTTPS in production

### 💰 Per Diem Integration
- Automatic lookup of GSA per diem rates by city and date
- Support for both lodging and meals & incidentals
- Real-time rate calculation based on expense type
- Uses official GSA API with environment-secured API key

### 📊 Expense Management
- Add expenses one by one (similar to Excel entry)
- Categorize as Lodging or Food expenses
- Automatic per diem calculation for each expense
- Track receipt amounts vs. per diem allowances

### 📋 Data Organization
- Clean, organized table display
- Separate sections for Lodging and Food expenses
- Running totals and grand total calculation
- Export to CSV functionality

### 🌟 Modern Interface
- Responsive design that works on all devices
- Beautiful gradient styling
- Real-time summary cards showing totals
- Intuitive form-based data entry

## Usage

1. **Login**: Use the credentials to log in securely. Ensure you have the correct environment variables set up for authentication.

2. **Add Expenses**:
   - Select expense type (Lodging or Food)
   - Enter date, establishment name, and receipt amount
   - Enter city and state (2-letter code)
   - Click "Get Per Diem Rate" to automatically fetch the GSA rate
   - Add optional notes
   - Click "Add Expense" to save

3. **View & Manage**:
   - All expenses are displayed in an organized table
   - Summary cards show running totals
   - Delete individual expenses as needed
   - Export all data to CSV format

4. **Export Data**: Click "Export to CSV" to download your expense report

## API Integration

This application uses the official GSA Per Diem API:
- **Base URL**: `https://api.gsa.gov/travel/perdiem/v2`
- **API Key**: Securely stored server-side
- **Rate Limiting**: Protected by authentication system

## Technical Details

- **Backend**: Node.js with Express.js
- **Frontend**: Vanilla JavaScript with modern ES6+ features
- **Storage**: Local browser storage for data persistence
- **Authentication**: Express sessions
- **Node Version**: 22+ (AWS compatible)

## Security

- API key is stored server-side only
- Session-based authentication
- Protected routes require login
- No sensitive data exposed to client

### Deployment Steps

1. **Create App Runner Service:**
   - Go to AWS App Runner console
   - Create new service
   - Choose "Source code repository"

2. **Configure Build:**
   - Runtime: Node.js 22
   - Build command: `npm ci --only=production`
   - Start command: `node server.js`
   - Port: 3002

3. **Set Environment Variables:**
   - In App Runner service configuration
   - Add all required environment variables
   - **CRITICAL:** Never commit `.env` file to source control

4. **Configure Security:**
   - HTTPS automatically enabled
   - Secure session cookies in production
   - Environment-based credential management

### Security Features

- ✅ Environment variables for all secrets
- ✅ HTTPS enforced in production
- ✅ Secure session cookies with proper SameSite settings
- ✅ No hardcoded credentials in source code
- ✅ Input validation and sanitization

## Notes

- Data persists in browser local storage
- Application requires internet connection for GSA API calls
- Designed for single-user use with environment-configured credentials
- Production-ready with AWS App Runner deployment support
