import os
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

class SheetsClient:
    def __init__(self):
        self.scopes = ['https://www.googleapis.com/auth/spreadsheets']
        self.creds_file = 'data/credentials.json'
        self.spreadsheet_id = os.getenv('SPREADSHEET_ID')
        self.service = None
        
        if not self.spreadsheet_id:
            print("[SheetsClient] Missing SPREADSHEET_ID in .env")
            return
            
        if not os.path.exists(self.creds_file):
            print(f"[SheetsClient] Missing credentials file at {self.creds_file}")
            return
            
        try:
            creds = Credentials.from_service_account_file(
                self.creds_file, scopes=self.scopes)
            self.service = build('sheets', 'v4', credentials=creds)
            print("[SheetsClient] Successfully authenticated with Google Sheets.")
        except Exception as e:
            print(f"[SheetsClient] Error authenticating: {e}")

    def append_job_to_sheet(self, job_data, evaluation):
        if not self.service or not self.spreadsheet_id:
            return False
            
        # Format: Date, Title, Company, URL, Status, Reasoning
        row_data = [
            datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            job_data.get('title', ''),
            job_data.get('company', ''),
            job_data.get('url', ''),
            "Draft",
            evaluation.reasoning
        ]
        
        body = {
            'values': [row_data]
        }
        
        try:
            # We append to 'Sheet1' by default. If the user names it differently, this might fail, 
            # but usually it's Sheet1 or we can just append to the first sheet using its index 
            # However, providing just 'A:F' usually works to append to the first visible sheet.
            range_name = 'Sheet1!A:F'
            result = self.service.spreadsheets().values().append(
                spreadsheetId=self.spreadsheet_id,
                range=range_name,
                valueInputOption='USER_ENTERED',
                body=body
            ).execute()
            
            print(f"    [SheetsClient] Appended row to Google Sheet: {result.get('updates').get('updatedRange')}")
            return True
        except Exception as e:
            print(f"    [SheetsClient] Error appending to sheet: {e}")
            
            # Fallback if 'Sheet1' doesn't exist, try just appending to whatever the first sheet is
            try:
                result = self.service.spreadsheets().values().append(
                    spreadsheetId=self.spreadsheet_id,
                    range='A:F',
                    valueInputOption='USER_ENTERED',
                    body=body
                ).execute()
                print(f"    [SheetsClient] Appended row to Google Sheet (fallback range): {result.get('updates').get('updatedRange')}")
                return True
            except Exception as e2:
                print(f"    [SheetsClient] Fallback append failed: {e2}")
                return False
