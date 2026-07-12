"""
Consolidated Data Processor
Combines scrapping, student data updates, project completion, and season progress
Run with: python data_processor.py [--scrape] [--students] [--projects] [--progress] [--all]
"""

import argparse
import sys
import os
import json
import requests
import time
import re
from datetime import datetime, timedelta
from bs4 import BeautifulSoup

# Import our utilities
from utils import (
    get_supabase_client, map_season_name_to_db, parse_relative_time_to_timestamp,
    load_scraped_data, get_student_id_map, get_project_id_map, get_season_id_map,
    safe_upsert, safe_update, print_step, safe_print
)

class QwasarScraper:
    """Handles web scraping from Qwasar platform"""
    
    def __init__(self, supabase_client=None):
        self.username = os.getenv('SCRAPER_USERNAME')
        self.password = os.getenv('SCRAPER_PASSWORD')
        
        if not self.username or not self.password:
            raise ValueError("SCRAPER_USERNAME and SCRAPER_PASSWORD must be set in environment")
        
        self.session = requests.Session()
        self.supabase = supabase_client or get_supabase_client()
    
    def get_auth_token(self):
        """Get authentication token for login"""
        url = "https://casapp.us.qwasar.io/login"
        params = {"service": "https%3A%2F%2Fupskill.us.qwasar.io%2Fusers%2Fservice"}
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.14; rv:109.0) Gecko/20100101 Firefox/110.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "fr,fr-FR;q=0.8,en-US;q=0.5,en;q=0.3",
            "Accept-Encoding": "gzip, deflate",
            "Dnt": "1",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Te": "trailers"
        }
        
        try:
            response = self.session.get(url, params=params, headers=headers)
            response.raise_for_status()  # Raise an exception for bad status codes
            
            # Extract CSRF token
            auth_token = re.search(r'<meta\s+name="csrf-token"\s+content="([a-zA-Z0-9\/+=]+)"\s*/>', response.text)
            if not auth_token:
                raise Exception("Could not find CSRF token in response")
            
            # Extract LT token
            lt_pattern = r'<input type="hidden" name="lt" id="lt" value="([^"]+)" autocomplete="off" />'
            lt_match = re.search(lt_pattern, response.text)
            if not lt_match:
                raise Exception("Could not find LT token in response")
            
            lt_value = lt_match.group(1)
            appcas_session = response.cookies.get('_appcas_session')
            
            if not appcas_session:
                raise Exception("Could not get session cookie")
            
            safe_print("[OK] Successfully extracted authentication tokens")
            return auth_token.group(1), lt_value, appcas_session
            
        except requests.RequestException as e:
            raise Exception(f"Network error during authentication: {e}")
        except Exception as e:
            print(f"Auth token extraction failed: {e}")
            print(f"Response status: {response.status_code if 'response' in locals() else 'N/A'}")
            raise Exception(f"Could not extract authentication tokens: {e}")
    
    def login(self):
        """Authenticate with Qwasar platform using working method"""
        print_step("AUTHENTICATION", "Logging into Qwasar platform")
        
        try:
            cookies = self.get_tokens()
            if cookies and cookies.get('user.id') and cookies.get('_session_id'):
                safe_print("[OK] Authentication successful")
                self.session_cookies = cookies
                return True
            else:
                raise Exception("Failed to obtain valid session cookies")
                
        except Exception as e:
            safe_print(f"[ERROR] Authentication error: {e}")
            raise Exception(f"Authentication failed: {e}")
    
    def get_tokens(self):
        """Original working token method from scraper.py"""
        url = 'https://upskill.us.qwasar.io/login'
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.14; rv:109.0) Gecko/20100101 Firefox/110.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'fr,fr-FR;q=0.8,en-US;q=0.5,en;q=0.3',
            'Accept-Encoding': 'gzip, deflate',
            'Dnt': '1',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Te': 'trailers'
        }

        response = requests.get(url, headers=headers, allow_redirects=False)
        sessionIdCookies = response.cookies
        
        auth_token, lt_value, appcas_session = self.get_auth_token()
        
        url = 'https://casapp.us.qwasar.io/login'
        cookies = {'_appcas_session': appcas_session}
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.14; rv:109.0) Gecko/20100101 Firefox/110.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'fr,fr-FR;q=0.8,en-US;q=0.5,en;q=0.3',
            'Accept-Encoding': 'gzip, deflate',
            'Referer': 'https://casapp.us.qwasar.io/login?service=https%3A%2F%2Fupskill.us.qwasar.io%2Fusers%2Fservice',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Origin': 'https://casapp.us.qwasar.io',
            'Dnt': '1',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-User': '?1',
            'Te': 'trailers'
        }

        data = {
            'authenticity_token': auth_token,
            'lt': lt_value,
            'service': 'https://upskill.us.qwasar.io/users/service',
            'username': self.username,
            'password': self.password,
        }

        res = requests.post(url, cookies=cookies, headers=headers, data=data, allow_redirects=False)
        
        match = re.search(r'<a\s+href="(.*?)">', res.text)
        if not match:
            raise Exception("Could not find redirect URL in login response")

        redirect_url = match.group(1)
        session_cookies = {'_session_id': sessionIdCookies.get('_session_id')}
        res = requests.get(redirect_url, headers=headers, cookies=session_cookies, allow_redirects=False)
        
        user_id = res.cookies.get('user.id')
        session_id = res.cookies.get('_session_id')
        
        return {'user.id': user_id, '_session_id': session_id}
    
    def get_session_cookies(self):
        """Get session cookies"""
        return getattr(self, 'session_cookies', {})
    
    def get_student_usernames(self, limit=None, exclude_inactive=True):
        """Fetch student usernames from Supabase database"""
        try:
            safe_print("[INFO] Fetching student usernames from database...")

            # Build query - get username and account_status
            query = self.supabase.from_('students').select('username, account_status')

            # Optional: Filter out inactive students based on account_status
            if exclude_inactive:
                # Only include students with 'Active' account_status
                query = query.eq('account_status', 'Active')

            # Optional: Limit number of students (useful for testing)
            if limit:
                query = query.limit(limit)

            response = query.execute()

            if response.data:
                usernames = [student['username'] for student in response.data
                           if student.get('username') and student.get('username').strip()]

                # Remove any None or empty usernames
                usernames = [u for u in usernames if u]

                safe_print(f"[OK] Found {len(usernames)} student usernames in database")

                # Log first few usernames for verification
                if usernames:
                    preview = usernames[:5]
                    print(f"  Preview: {', '.join(preview)}{'...' if len(usernames) > 5 else ''}")

                return usernames
            else:
                safe_print("[WARN] No students found in database")
                return []

        except Exception as e:
            safe_print(f"[ERROR] Error fetching student usernames: {e}")
            import traceback
            traceback.print_exc()
            return []
    
    def extract_student_data(self, html_content, student_id):
        """Extract data from a student's profile page using original working logic"""
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Use the exact working scrape function from original scraper
        data = self.scrape_data_original(html_content, student_id)
        
        return {
            'img_url': data.get('img'),
            'last_login': data.get('last_log_in', 'N/A'),
            'ongoing_projects': data.get('ongoing_projects', []),
            'completed_projects': data.get('completed_projects', []),
            'exercises_completed': data.get('exercises_completed'),
            'points': data.get('points'),
            'season_progress': data.get('seasons', {})
        }
    
    def scrape_data_original(self, text, student_id):
        """Original working scrape function from scraper.py"""
        dic = {}
        seasons_data = {}  # Only for seasons
        ongoing_projects = []
        completed_projects = []

        soup = BeautifulSoup(text, 'html.parser')
        # Locate all card elements
        cards = soup.find_all('div', {'class': 'card-with-header'})

        # Extract image
        img_element = soup.find('img', {'height': '256'})
        image = img_element['src'] if img_element else None
        
        # Extract last login
        last_log_ing = soup.find('time', {'data-format': '%B %e, %Y %l:%M%P'})
        if last_log_ing:
            last_log_in = last_log_ing.get_text(strip=True)
        else:
            last_log_in = "N/A"

        # Extract projects
        projects = self.harvest_projects_original(soup)
        projects_completed = self.harvest_projects_completed_original(soup)
        completed_projects.extend(projects_completed)
        ongoing_projects.extend(projects)

        # Process each card to extract season progress
        for card in cards:
            dictmp = self.harvest_block_original(card)
            seasons_data.update(dictmp)

        exercises_completed = self.harvest_exercises_completed_original(soup)
        points = self.harvest_points_original(soup)

        # Add extracted data to the main dictionary
        dic["seasons"] = seasons_data
        dic["img"] = image
        dic["last_log_in"] = last_log_in
        dic["ongoing_projects"] = ongoing_projects
        dic["completed_projects"] = completed_projects
        dic["exercises_completed"] = exercises_completed
        dic["points"] = points

        return dic
    
    def harvest_exercises_completed_original(self, soup):
        """Original working method from scraper.py"""
        try:
            li = soup.find('li', class_='row flex')
            if li and 'Exercises Completed' in li.text:
                spans = li.find_all('span')
                if len(spans) > 1:
                    return spans[1].text.strip()
        except Exception as e:
            print(f"Error extracting exercises completed: {e}")
        return None

    def harvest_points_original(self, soup):
        """Original working method from scraper.py"""
        try:
            # Find the div with the SVG and a number
            for div in soup.find_all('div', class_='flex items-center gap-2'):
                # Check if it contains an SVG and a span with a number
                if div.find('svg') and div.find('span'):
                    spans = div.find_all('span')
                    if spans and spans[-1].text.strip().isdigit():
                        return spans[-1].text.strip()
        except Exception as e:
            print(f"Error extracting points: {e}")
        return None

    def harvest_projects_completed_original(self, soup):
        """Original working method from scraper.py"""
        projects = []
        try:
            # Find the header with the text 'Projects Completed'
            header = soup.find("h2", string=lambda t: t and "Projects Completed" in t)
            
            if header:
                # Locate the outermost container of the section
                section_container = header.find_parent("div", class_="col-span-full")
                
                if section_container:
                    # Find all divs with project items inside the section
                    for project_div in section_container.find_all("div", class_="border-b border-slate-800"):
                        # Extract the <a> link inside each <li>
                        li = project_div.find("li", class_="flex gap-3 px-3 py-2 text-sm")
                        if li:
                            link = li.find("a", href=True)
                            if link:
                                projects.append(link.text.strip())
        except Exception as e:
            print(f"Error extracting completed projects: {e}")
        return projects

    def harvest_projects_original(self, soup):
        """Original working method from scraper.py"""
        projects = []
        try:
            # Find the header with the text 'Projects In Progress'
            header = soup.find("h2", string=lambda t: t and "Projects In Progress" in t)

            if header:
                # Locate the outermost container of the section
                section_container = header.find_parent("div", class_="col-span-full")
                
                if section_container:
                    # Find all divs with project items inside the section
                    for project_div in section_container.find_all("div", class_="border-b border-slate-800"):
                        # Extract the <a> link inside each <li>
                        li = project_div.find("li", class_="flex gap-3 px-3 py-2 text-sm")
                        if li:
                            link = li.find("a", href=True)
                            if link:
                                projects.append(link.text.strip())
        except Exception as e:
            print(f"Error extracting ongoing projects: {e}")
        return projects

    def harvest_block_original(self, card):
        """Original working method from scraper.py"""
        dic = {}
        try:
            # Extract the track name
            track_name = card.find("h2", class_="text-xl").text.strip()
            
            # Extract progress percentage
            progress_bar = card.find('div', class_='bg-yellow-400') or card.find('div', class_='bg-green-500')
            if progress_bar:
                progress_percent = progress_bar['style'].split('width:')[1].strip().replace(';', '')
            else:
                progress_percent = 'Unknown'
            
            dic[track_name] = progress_percent

        except Exception as e:
            print(f"Error processing track: {e}")
        
        return dic
    
    def extract_projects_in_progress(self, soup):
        """Extract ongoing projects"""
        projects = []
        try:
            # Find the header with the text 'Projects In Progress'
            header = soup.find("h2", string=lambda t: t and "Projects In Progress" in t)
            
            if header:
                # Locate the outermost container of the section
                section_container = header.find_parent("div", class_="col-span-full")
                
                if section_container:
                    # Find all divs with project items inside the section
                    for project_div in section_container.find_all("div", class_="border-b border-slate-800"):
                        # Extract the <a> link inside each <li>
                        li = project_div.find("li", class_="flex gap-3 px-3 py-2 text-sm")
                        if li:
                            link = li.find("a", href=True)
                            if link:
                                projects.append(link.text.strip())
        except Exception as e:
            print(f"Error extracting ongoing projects: {e}")
        
        return projects
    
    def extract_completed_projects(self, soup):
        """Extract completed projects"""
        projects = []
        try:
            # Find the header with the text 'Projects Completed'
            header = soup.find("h2", string=lambda t: t and "Projects Completed" in t)
            
            if header:
                # Locate the outermost container of the section
                section_container = header.find_parent("div", class_="col-span-full")
                
                if section_container:
                    # Find all divs with project items inside the section
                    for project_div in section_container.find_all("div", class_="border-b border-slate-800"):
                        # Extract the <a> link inside each <li>
                        li = project_div.find("li", class_="flex gap-3 px-3 py-2 text-sm")
                        if li:
                            link = li.find("a", href=True)
                            if link:
                                projects.append(link.text.strip())
        except Exception as e:
            print(f"Error extracting completed projects: {e}")
        
        return projects
    
    def extract_exercises_completed(self, soup):
        """Extract exercises completed count"""
        try:
            li = soup.find('li', class_='row flex')
            if li and 'Exercises Completed' in li.text:
                spans = li.find_all('span')
                if len(spans) > 1:
                    return spans[1].text.strip()
        except Exception as e:
            print(f"Error extracting exercises completed: {e}")
        return None
    
    def extract_points(self, soup):
        """Extract points"""
        try:
            # Find the div with the SVG and a number
            for div in soup.find_all('div', class_='flex items-center gap-2'):
                # Check if it contains an SVG and a span with a number
                if div.find('svg') and div.find('span'):
                    spans = div.find_all('span')
                    if spans and spans[-1].text.strip().isdigit():
                        return spans[-1].text.strip()
        except Exception as e:
            print(f"Error extracting points: {e}")
        return None
    
    def extract_season_progress(self, soup):
        """Extract season progress data"""
        season_data = {}
        try:
            cards = soup.find_all('div', {'class': 'card-with-header'})
            for card in cards:
                try:
                    # Extract season name
                    track_name_element = card.find("h2", class_="text-xl")
                    if not track_name_element:
                        continue
                        
                    track_name = track_name_element.text.strip()
                    
                    # Extract progress percentage
                    progress_bar = card.find('div', class_='bg-yellow-400') or card.find('div', class_='bg-green-500')
                    if progress_bar:
                        style = progress_bar.get('style', '')
                        if 'width:' in style:
                            # Extract percentage from style attribute
                            progress_percent = style.split('width:')[1].strip().replace(';', '').replace('%', '')
                            try:
                                percentage = float(progress_percent) if progress_percent else 0
                            except ValueError:
                                percentage = 0
                            season_data[track_name] = {
                                'completion_percentage': percentage
                            }
                        else:
                            season_data[track_name] = {'completion_percentage': 0}
                    else:
                        season_data[track_name] = {'completion_percentage': 0}
                        
                except Exception as e:
                    print(f"Error processing season card: {e}")
                    continue
                    
        except Exception as e:
            print(f"Error extracting season progress: {e}")
        
        return season_data
    
    def scrape_student_data(self, limit=None, include_inactive=False):
        """Scrape student data from the platform"""
        print_step("SCRAPING", "Extracting student data from Qwasar platform")
    
        try:
            if not self.login():
                raise Exception("Login failed")
            
            # Get student IDs dynamically from database
            student_ids = self.get_student_usernames(
                limit=limit,
                exclude_inactive=not include_inactive
            )
            
            if not student_ids:
                raise Exception("No student usernames found to scrape")
            
            scraped_data = []
            base_url = "https://upskill.us.qwasar.io/users/"
            
            print(f"Starting to scrape {len(student_ids)} students...")
            
            for i, student_id in enumerate(student_ids, 1):
                try:
                    print(f"\n{'='*60}")
                    print(f"Scraping student {i}/{len(student_ids)}: {student_id}")
                    print(f"{'='*60}")
                    
                    # Get student profile page using cookies directly
                    url = base_url + student_id
                    cookies = self.get_session_cookies()
                    response = requests.get(url, cookies=cookies)
                    response.raise_for_status()
                    
                    # Check if we're actually logged in
                    if 'login' in response.url.lower() or 'sign in' in response.text.lower()[:500]:
                        print(f"WARNING: Appears to be redirected to login page!")
                        print(f"Current URL: {response.url}")
                        print(f"Response length: {len(response.text)} characters")
                        # Try to re-login
                        if self.login():
                            cookies = self.get_session_cookies()
                            response = requests.get(url, cookies=cookies)
                        else:
                            raise Exception("Re-login failed")
                    
                    # Extract data from the page
                    student_data = self.extract_student_data(response.text, student_id)
                    student_data['name'] = student_id
                    
                    scraped_data.append(student_data)
                    
                    # Small delay to be respectful
                    time.sleep(0.5)
                    
                except Exception as e:
                    print(f"Failed to scrape {student_id}: {e}")
                    import traceback
                    traceback.print_exc()
                    continue
            
            # Add metadata
            scraped_data.append({
                "last_modified": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                "total_students": len(scraped_data) - 1  # Exclude metadata entry
            })
            
            safe_print(f"\n[OK] Successfully scraped data for {len(scraped_data) - 1} students")
            return scraped_data
                
        except Exception as e:
            safe_print(f"[X] Scraping failed: {e}")
            import traceback
            traceback.print_exc()
            safe_print("[RETRY] Attempting to fall back to existing data...")
            
            # Try to use existing data as fallback
            existing_data = load_scraped_data()
            if existing_data:
                safe_print(f"[OK] Using existing data as fallback ({len(existing_data)} records)")
                return existing_data
            else:
                raise Exception(f"Scraping failed and no existing data available: {e}")

class StudentDataProcessor:
    """Handles student data updates including extra data and season progress"""
    
    def __init__(self, supabase_client):
        self.supabase = supabase_client
        self.student_id_map = get_student_id_map(supabase_client)
        self.season_id_map = get_season_id_map(supabase_client)
        
        # Get student program mapping for season filtering
        self.student_program_map = self._get_student_program_map()

        # Get seasons grouped by program for proper filtering
        self.seasons_by_program = self._get_seasons_by_program()

        # Denormalized student identity info, used to make
        # student_duplicate_project_report rows readable without joins
        self.student_details_map = self._get_student_details_map()
    
    def _get_student_program_map(self):
        """Get mapping of student_id to program_id"""
        try:
            response = self.supabase.from_('students').select('id, program_id').execute()
            return {row['id']: row['program_id'] for row in response.data}
        except Exception as e:
            print(f"Error fetching student program mapping: {e}")
            return {}

    def _get_student_details_map(self):
        """Get mapping of student_id -> identity fields, for denormalizing
        onto student_duplicate_project_report rows."""
        try:
            response = self.supabase.from_('students').select(
                'id, username, email, first_name, last_name'
            ).execute()
            return {row['id']: row for row in response.data}
        except Exception as e:
            print(f"Error fetching student details map: {e}")
            return {}

    def _get_seasons_by_program(self):
        """Get seasons grouped by program_id"""
        try:
            response = self.supabase.from_('seasons').select('id, name, program_id').execute()
            seasons_by_program = {}
            for row in response.data:
                program_id = row['program_id']
                if program_id not in seasons_by_program:
                    seasons_by_program[program_id] = {}
                seasons_by_program[program_id][row['name']] = row['id']
            return seasons_by_program
        except Exception as e:
            print(f"Error fetching seasons by program: {e}")
            return {}
    
    def update_student_extra_data(self, scraped_data):
        """Update student extra information (last login, points, etc.)"""
        print_step("STUDENT EXTRA DATA", "Updating student details, points, and login info")
        
        records_to_update = []
        
        for student_data in scraped_data:
            username = student_data.get("name")
            if not username or username not in self.student_id_map:
                continue
            
            student_id = self.student_id_map[username]
            
            # Prepare update record
            update_record = {"id": student_id}
            
            # Handle last login
            if "last_login" in student_data:
                last_login_timestamp = parse_relative_time_to_timestamp(student_data["last_login"])
                if last_login_timestamp:
                    update_record["last_login"] = last_login_timestamp
            
            # Handle current season - infer from season_progress
            season_progress = student_data.get("season_progress", {})
            if season_progress:
                # Get student's program to filter seasons correctly
                student_program_id = self.student_program_map.get(student_id)

                if not student_program_id:
                    print(f"Warning: No program found for student {username}, cannot determine current season")
                elif student_program_id not in self.seasons_by_program:
                    print(f"Warning: No seasons found for program {student_program_id}")
                else:
                    # Get seasons that belong to this student's program
                    program_seasons = self.seasons_by_program[student_program_id]

                    # Filter season_progress to only include seasons from the student's program
                    filtered_season_progress = {}
                    for season_name, progress_str in season_progress.items():
                        mapped_season = map_season_name_to_db(season_name)
                        if mapped_season and mapped_season in program_seasons:
                            filtered_season_progress[season_name] = progress_str

                    if not filtered_season_progress:
                        print(f"Warning: No program-relevant seasons found for {username} in season_progress: {season_progress}")
                    else:
                        # Seasons are listed in chronological order in the dict
                        # The LAST season (not 100% complete) is the current one
                        # If all are 100%, use the last one anyway
                        current_season_name = None
                        last_season_name = None

                        # Python 3.7+ maintains dict insertion order, so we can rely on it
                        # Find the last season that's not 100% complete
                        for season_name, progress_str in filtered_season_progress.items():
                            last_season_name = season_name  # Always track the last season

                            try:
                                # Parse percentage string like "3%" or "75%"
                                if isinstance(progress_str, str):
                                    if progress_str == 'Unknown':
                                        progress_value = 0
                                    elif progress_str.endswith('%'):
                                        progress_value = float(progress_str[:-1])
                                    else:
                                        progress_value = float(progress_str)
                                else:
                                    progress_value = float(progress_str)

                                # Keep updating to the latest season that's not completed
                                if progress_value < 100:
                                    current_season_name = season_name
                            except (ValueError, TypeError):
                                # If we can't parse, still consider it as potential current season
                                current_season_name = season_name
                                continue

                        # If no season < 100% was found, use the last season in the list
                        if not current_season_name and last_season_name:
                            current_season_name = last_season_name
                            print(f"All seasons 100% complete for {username}, using last season: {current_season_name}")

                        # Map and set current season
                        if current_season_name:
                            mapped_season = map_season_name_to_db(current_season_name)
                            season_id = program_seasons.get(mapped_season)

                            if season_id:
                                update_record["current_season_id"] = season_id
                                print(f"Set current season for {username}: {current_season_name} (progress: {filtered_season_progress.get(current_season_name)})")
                            else:
                                print(f"Warning: Season '{mapped_season}' not found in program {student_program_id} for student {username}")
            
            # Handle other fields
            if "img_url" in student_data:
                update_record["profile_image_url"] = student_data["img_url"]
            if "points" in student_data:
                update_record["points"] = student_data["points"]
            if "exercises_completed" in student_data:
                update_record["exercises_completed"] = student_data["exercises_completed"]
            
            if len(update_record) > 1:  # More than just the ID
                records_to_update.append(update_record)

        if records_to_update:
            safe_update(self.supabase, 'students', records_to_update)
        else:
            print("No student records to update")
    
    def update_season_progress(self, scraped_data):
        """Update student season progress"""
        print_step("SEASON PROGRESS", "Updating student progress across seasons")

        # Keyed by (student_id, season_id) rather than a plain list. Multiple
        # raw scraped season names can collapse onto the same season_id for
        # one student -- either a genuine data quirk, or (per university
        # policy) a student deliberately taking an extra track in parallel
        # (e.g. Data Science AND Fullstack/Backend at once, an allowed paid
        # option). Appending each as a separate row previously produced two
        # rows with an identical (student_id, season_id) key in the same
        # upsert batch, which Postgres rejects outright with "ON CONFLICT DO
        # UPDATE command cannot affect row a second time" -- silently
        # failing the ENTIRE batch, not just the colliding student.
        #
        # Fix: keep only the higher-progress entry per (student_id,
        # season_id) for the real student_season_progress table (this is
        # what drives status/progress calculations), and preserve the
        # lower-progress "extra track" entry in student_duplicate_project_report
        # instead of discarding it, so it stays visible for review.
        records_by_key = {}
        raw_label_by_key = {}   # tracks which raw scraped label won, for reporting
        duplicate_reports = {}  # keyed by (student_id, season_id, discarded_label)
        duplicates_resolved = 0

        for student_data in scraped_data:
            username = student_data.get("name")
            if not username or username not in self.student_id_map:
                continue
            
            student_id = self.student_id_map[username]
            
            # Get the student's program to filter seasons correctly
            student_program_id = self.student_program_map.get(student_id)
            if not student_program_id:
                print(f"Warning: No program found for student {username}")
                continue
            
            # Get seasons for this student's specific program
            program_seasons = self.seasons_by_program.get(student_program_id, {})
            if not program_seasons:
                print(f"Warning: No seasons found for program {student_program_id}")
                continue
            
            # Process season progress data
            season_progress = student_data.get("season_progress", {})
            for season_name, progress_data in season_progress.items():
                mapped_season_name = map_season_name_to_db(season_name)
                if not mapped_season_name:
                    continue
                
                # IMPORTANT: Only match seasons from the student's program
                season_id = program_seasons.get(mapped_season_name)
                if not season_id:
                    # Skip seasons that don't belong to this student's program
                    print(f"Skipping season '{mapped_season_name}' - not found in program {student_program_id} for student {username}")
                    continue
                
                # Handle progress_data - could be string percentage or dict
                if isinstance(progress_data, str):
                    # Convert percentage string like "75%" to float
                    try:
                        if progress_data == 'Unknown':
                            completion_percentage = 0
                        elif progress_data.endswith('%'):
                            completion_percentage = float(progress_data[:-1])
                        else:
                            completion_percentage = float(progress_data)
                    except (ValueError, TypeError):
                        completion_percentage = 0
                elif isinstance(progress_data, dict):
                    completion_percentage = progress_data.get("progress_percentage", 0)
                else:
                    completion_percentage = 0
                
                # Create progress record
                progress_record = {
                    "student_id": student_id,
                    "season_id": season_id,
                    "progress_percentage": completion_percentage,
                    "is_completed": completion_percentage >= 100,
                    # "completion_date": datetime.now().date().isoformat() if completion_percentage >= 100 else None,
                    "updated_at": datetime.now().isoformat() if completion_percentage >= 100 else None,
                }

                key = (student_id, season_id)
                existing = records_by_key.get(key)

                if existing is None:
                    records_by_key[key] = progress_record
                    raw_label_by_key[key] = season_name
                    continue

                duplicates_resolved += 1
                existing_label = raw_label_by_key[key]
                existing_pct = existing["progress_percentage"]

                if completion_percentage > existing_pct:
                    kept_label, kept_pct = season_name, completion_percentage
                    discarded_label, discarded_pct = existing_label, existing_pct
                    records_by_key[key] = progress_record
                    raw_label_by_key[key] = season_name
                else:
                    kept_label, kept_pct = existing_label, existing_pct
                    discarded_label, discarded_pct = season_name, completion_percentage

                print(f"  Duplicate season entry for {username} (season_id={season_id}): "
                      f"keeping '{kept_label}' ({kept_pct}%) over '{discarded_label}' ({discarded_pct}%)")

                details = self.student_details_map.get(student_id, {})
                report_key = (student_id, season_id, discarded_label)
                duplicate_reports[report_key] = {
                    "student_id": student_id,
                    "student_username": details.get("username", username),
                    "student_email": details.get("email", ""),
                    "student_first_name": details.get("first_name", ""),
                    "student_last_name": details.get("last_name", ""),
                    "season_id": season_id,
                    "season_name": mapped_season_name,
                    "kept_raw_label": kept_label,
                    "kept_progress_percentage": kept_pct,
                    "discarded_raw_label": discarded_label,
                    "discarded_progress_percentage": discarded_pct,
                    "scraped_at": datetime.now().isoformat()
                }

        records_to_upsert = list(records_by_key.values())
        reports_to_upsert = list(duplicate_reports.values())

        if duplicates_resolved:
            safe_print(f"[INFO] Resolved {duplicates_resolved} duplicate season-progress entr"
                       f"{'y' if duplicates_resolved == 1 else 'ies'} before upsert")

        if records_to_upsert:
            safe_upsert(self.supabase, 'student_season_progress', records_to_upsert, 
                       on_conflict="student_id, season_id")

        if reports_to_upsert:
            safe_upsert(self.supabase, 'student_duplicate_project_report', reports_to_upsert,
                       on_conflict="student_id, season_id, discarded_raw_label")
            safe_print(f"[OK] Recorded {len(reports_to_upsert)} duplicate-track report "
                       f"{'entry' if len(reports_to_upsert) == 1 else 'entries'}")
            safe_print(f"[OK] Updated {len(records_to_upsert)} season progress records")
        else:
            print("No season progress records to update")
    
    def cleanup_incorrect_season_progress(self):
        """Remove student season progress records where the season doesn't belong to the student's program"""
        print_step("CLEANUP", "Removing incorrect cross-program season progress records")
        
        try:
            # Get all student season progress records with student and season program info
            response = self.supabase.from_('student_season_progress').select(
                '''
                id, 
                student_id,
                season_id,
                students!inner(program_id),
                seasons!inner(program_id)
                '''
            ).execute()
            
            incorrect_records = []
            for record in response.data:
                student_program = record['students']['program_id']
                season_program = record['seasons']['program_id']
                
                # If student's program doesn't match season's program, mark for deletion
                if student_program != season_program:
                    incorrect_records.append(record['id'])
                    print(f"Found incorrect record: student program {student_program} vs season program {season_program}")
            
            if incorrect_records:
                # Delete incorrect records
                for record_id in incorrect_records:
                    self.supabase.from_('student_season_progress').delete().eq('id', record_id).execute()
                
                safe_print(f"[OK] Removed {len(incorrect_records)} incorrect season progress records")
            else:
                safe_print("[OK] No incorrect season progress records found")
                
        except Exception as e:
            print(f"Error during cleanup: {e}")
            import traceback
            traceback.print_exc()

class ProjectCompletionProcessor:
    """Handles project completion data updates"""
    
    def __init__(self, supabase_client):
        self.supabase = supabase_client
        self.student_id_map = get_student_id_map(supabase_client)
        self.project_id_map = get_project_id_map(supabase_client)
    
    # Projects that appear in multiple seasons and should be marked complete across all
    MULTI_SEASON_PROJECTS = {"My Css Is Easy I", "My Levenshtein", "My Cat"}

    def update_project_completion(self, scraped_data):
        """Update student project completion data"""
        print_step("PROJECT COMPLETION", "Updating student project completion status")

        records_dict = {}

        for student_data in scraped_data:
            username = student_data.get("name")
            if not username or username not in self.student_id_map:
                continue

            student_id = self.student_id_map[username]

            # Process completed projects first (these take priority)
            for project_name in student_data.get("completed_projects", []):
                project_ids = self.project_id_map.get(project_name, [])

                # For multi-season projects, mark ALL IDs as completed
                # For regular projects, just use the first ID
                if project_name in self.MULTI_SEASON_PROJECTS:
                    ids_to_mark = project_ids
                else:
                    ids_to_mark = project_ids[:1] if project_ids else []

                for project_id in ids_to_mark:
                    key = (student_id, project_id)
                    records_dict[key] = {
                        "student_id": student_id,
                        "project_id": project_id,
                        "is_completed": True,
                        # "completion_date": datetime.now().date().isoformat(),
                        "completed_at": datetime.now().date().isoformat()
                    }

            # Process ongoing projects (only if not already completed)
            for project_name in student_data.get("ongoing_projects", []):
                project_ids = self.project_id_map.get(project_name, [])

                # For multi-season projects, mark ALL IDs
                # For regular projects, just use the first ID
                if project_name in self.MULTI_SEASON_PROJECTS:
                    ids_to_mark = project_ids
                else:
                    ids_to_mark = project_ids[:1] if project_ids else []

                for project_id in ids_to_mark:
                    key = (student_id, project_id)
                    if key not in records_dict:
                        records_dict[key] = {
                            "student_id": student_id,
                            "project_id": project_id,
                            "is_completed": False,
                            # "completion_date": None
                        }

        records_to_upsert = list(records_dict.values())

        if records_to_upsert:
            safe_upsert(self.supabase, 'student_project_completion', records_to_upsert,
                       on_conflict="student_id, project_id")
            safe_print(f"[OK] Updated {len(records_to_upsert)} project completion records")
        else:
            print("No project completion records to update")

def main():
    """Main function with CLI argument parsing"""
    parser = argparse.ArgumentParser(description='Process student data from Qwasar platform')
    parser.add_argument('--scrape', action='store_true', help='Scrape new data from Qwasar')
    parser.add_argument('--students', action='store_true', help='Update student extra data')
    parser.add_argument('--projects', action='store_true', help='Update project completion data')
    parser.add_argument('--progress', action='store_true', help='Update season progress data')
    parser.add_argument('--cleanup', action='store_true', help='Clean up incorrect cross-program season progress records')
    parser.add_argument('--all', action='store_true', help='Run all operations')
    parser.add_argument('--limit', type=int, help='Limit number of students to scrape (for testing)')
    parser.add_argument('--include-inactive', action='store_true', help='Include inactive students in scraping')
    
    args = parser.parse_args()
    
    # If no specific flags are provided, show help
    if not any([args.scrape, args.students, args.projects, args.progress, args.cleanup, args.all]):
        parser.print_help()
        return
    
    try:
        # Get Supabase client (use service role to bypass RLS)
        supabase = get_supabase_client(service_role=True)
        
        # Load or scrape data
        if args.scrape or args.all:
            scraper = QwasarScraper(supabase_client=supabase)
            scraped_data = scraper.scrape_student_data(
                limit=args.limit if hasattr(args, 'limit') else None,
                include_inactive=args.include_inactive if hasattr(args, 'include_inactive') else False
            )
            # Save scraped data to the correct path
            script_dir = os.path.dirname(os.path.abspath(__file__))
            json_path = os.path.join(script_dir, '..', 'public', 'student_grades.json')
            os.makedirs(os.path.dirname(json_path), exist_ok=True)
            
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(scraped_data, f, indent=2, ensure_ascii=False)
            safe_print(f"[OK] Saved scraped data to {json_path}")
        else:
            scraped_data = load_scraped_data()
        
        if not scraped_data:
            print("No data available to process")
            return
        
        # Process student extra data
        if args.students or args.all:
            student_processor = StudentDataProcessor(supabase)
            student_processor.update_student_extra_data(scraped_data)
        
        # Process project completion
        if args.projects or args.all:
            project_processor = ProjectCompletionProcessor(supabase)
            project_processor.update_project_completion(scraped_data)
        
        # Process season progress
        if args.progress or args.all:
            student_processor = StudentDataProcessor(supabase)
            student_processor.update_season_progress(scraped_data)
        
        # Clean up incorrect cross-program records
        if args.cleanup or args.all:
            student_processor = StudentDataProcessor(supabase)
            student_processor.cleanup_incorrect_season_progress()
        
        print_step("COMPLETED", "All selected operations completed successfully")
        
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()