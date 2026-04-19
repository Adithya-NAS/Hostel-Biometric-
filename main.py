import os
import sqlite3
import hashlib
import base64
import datetime
import hmac

from kivy.config import Config
Config.set('graphics', 'width', '420')
Config.set('graphics', 'height', '760')

from kivy.app import App
from kivy.lang import Builder
from kivy.uix.screenmanager import ScreenManager, Screen
from kivy.properties import StringProperty

try:
    from cryptography.fernet import Fernet
except ImportError:
    Fernet = None

DB_FILE = 'hostel_biometric.db'
KEY_FILE = 'secret.key'
LATE_HOUR = 9

class DBManager:
    def __init__(self, db_file=DB_FILE, key_file=KEY_FILE):
        self.db_file = db_file
        self.key_file = key_file
        self.conn = sqlite3.connect(self.db_file, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.encryption_key = self.load_or_create_key()
        self.fernet = Fernet(self.encryption_key) if Fernet else None
        self.create_tables()

    def load_or_create_key(self):
        if os.path.exists(self.key_file):
            with open(self.key_file, 'rb') as f:
                return f.read()

        if Fernet:
            key = Fernet.generate_key()
        else:
            key = base64.urlsafe_b64encode(hashlib.sha256(b'hostel-biometric-secret').digest())

        with open(self.key_file, 'wb') as f:
            f.write(key)
        return key

    def create_tables(self):
        self.conn.execute(
            '''CREATE TABLE IF NOT EXISTS admins (
                id INTEGER PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL
            )'''
        )
        self.conn.execute(
            '''CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                roll_no TEXT UNIQUE NOT NULL,
                room_no TEXT,
                phone TEXT
            )'''
        )
        self.conn.execute(
            '''CREATE TABLE IF NOT EXISTS biometrics (
                id INTEGER PRIMARY KEY,
                student_id INTEGER NOT NULL,
                biometric_type TEXT NOT NULL,
                biometric_hash TEXT NOT NULL,
                encrypted_template TEXT NOT NULL,
                UNIQUE(student_id, biometric_type),
                FOREIGN KEY(student_id) REFERENCES students(id)
            )'''
        )
        self.conn.execute(
            '''CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY,
                student_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                time TEXT NOT NULL,
                status TEXT NOT NULL,
                FOREIGN KEY(student_id) REFERENCES students(id)
            )'''
        )
        self.conn.commit()
        self.ensure_default_admin()

    def ensure_default_admin(self):
        cursor = self.conn.execute('SELECT COUNT(*) as count FROM admins')
        count = cursor.fetchone()['count']
        if count == 0:
            self.add_admin('admin', 'password123')

    def add_admin(self, username, password):
        password_hash = self.hash_password(password)
        try:
            self.conn.execute('INSERT INTO admins (username, password_hash) VALUES (?, ?)', (username, password_hash))
            self.conn.commit()
        except sqlite3.IntegrityError:
            pass

    def hash_password(self, password):
        salt = 'hostel-salt-2026'.encode()
        return hashlib.sha256(password.encode() + salt).hexdigest()

    def validate_admin(self, username, password):
        cursor = self.conn.execute('SELECT password_hash FROM admins WHERE username = ?', (username,))
        row = cursor.fetchone()
        if not row:
            return False
        return hmac.compare_digest(row['password_hash'], self.hash_password(password))

    def encrypt_data(self, value):
        if self.fernet:
            return self.fernet.encrypt(value.encode()).decode()
        return base64.b64encode(value.encode()).decode()

    def decrypt_data(self, value):
        if self.fernet:
            return self.fernet.decrypt(value.encode()).decode()
        return base64.b64decode(value.encode()).decode()

    def add_student(self, name, roll_no, room_no, phone):
        try:
            self.conn.execute(
                'INSERT INTO students (name, roll_no, room_no, phone) VALUES (?, ?, ?, ?)',
                (name, roll_no, room_no, phone)
            )
            self.conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False

    def update_student(self, student_id, name, roll_no, room_no, phone):
        self.conn.execute(
            'UPDATE students SET name=?, roll_no=?, room_no=?, phone=? WHERE id=?',
            (name, roll_no, room_no, phone, student_id)
        )
        self.conn.commit()

    def delete_student(self, student_id):
        self.conn.execute('DELETE FROM biometrics WHERE student_id = ?', (student_id,))
        self.conn.execute('DELETE FROM attendance WHERE student_id = ?', (student_id,))
        self.conn.execute('DELETE FROM students WHERE id = ?', (student_id,))
        self.conn.commit()

    def get_students(self):
        cursor = self.conn.execute('SELECT * FROM students ORDER BY name ASC')
        return [dict(row) for row in cursor.fetchall()]

    def get_student_by_roll(self, roll_no):
        cursor = self.conn.execute('SELECT * FROM students WHERE roll_no = ?', (roll_no,))
        row = cursor.fetchone()
        return dict(row) if row else None

    def store_biometric(self, student_id, biometric_type, biometric_hash, raw_template):
        encrypted_template = self.encrypt_data(raw_template)
        try:
            self.conn.execute(
                'INSERT OR REPLACE INTO biometrics (student_id, biometric_type, biometric_hash, encrypted_template) VALUES (?, ?, ?, ?)',
                (student_id, biometric_type, biometric_hash, encrypted_template)
            )
            self.conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False

    def list_biometrics(self):
        cursor = self.conn.execute('SELECT * FROM biometrics')
        return [dict(row) for row in cursor.fetchall()]

    def match_biometric(self, biometric_hash, biometric_type):
        cursor = self.conn.execute(
            'SELECT s.id as student_id, s.name, s.roll_no, s.room_no, s.phone FROM biometrics b JOIN students s ON b.student_id = s.id WHERE b.biometric_type = ? AND b.biometric_hash = ?',
            (biometric_type, biometric_hash)
        )
        row = cursor.fetchone()
        return dict(row) if row else None

    def has_duplicate_biometric(self, biometric_hash, biometric_type):
        cursor = self.conn.execute(
            'SELECT COUNT(*) as count FROM biometrics WHERE biometric_hash = ? AND biometric_type = ?',
            (biometric_hash, biometric_type)
        )
        return cursor.fetchone()['count'] > 0

    def add_attendance(self, student_id, status):
        now = datetime.datetime.now()
        self.conn.execute(
            'INSERT INTO attendance (student_id, date, time, status) VALUES (?, ?, ?, ?)',
            (student_id, now.date().isoformat(), now.time().strftime('%H:%M:%S'), status)
        )
        self.conn.commit()

    def get_attendance_logs(self, limit=100):
        cursor = self.conn.execute(
            'SELECT a.id, s.name, s.roll_no, a.date, a.time, a.status FROM attendance a JOIN students s ON a.student_id = s.id ORDER BY a.id DESC LIMIT ?',
            (limit,)
        )
        return [dict(row) for row in cursor.fetchall()]

    def get_report(self, period, anchor_date=None):
        anchor = anchor_date or datetime.date.today()
        if isinstance(anchor, str):
            try:
                anchor = datetime.datetime.strptime(anchor, '%Y-%m-%d').date()
            except ValueError:
                anchor = datetime.date.today()

        if period == 'monthly':
            start = anchor.replace(day=1)
            end = (start + datetime.timedelta(days=32)).replace(day=1)
            cursor = self.conn.execute(
                'SELECT s.name, s.roll_no, a.date, a.time, a.status FROM attendance a JOIN students s ON a.student_id = s.id WHERE a.date >= ? AND a.date < ? ORDER BY a.date DESC, a.time DESC',
                (start.isoformat(), end.isoformat())
            )
        else:
            cursor = self.conn.execute(
                'SELECT s.name, s.roll_no, a.date, a.time, a.status FROM attendance a JOIN students s ON a.student_id = s.id WHERE a.date = ? ORDER BY a.time DESC',
                (anchor.isoformat(),)
            )
        return [dict(row) for row in cursor.fetchall()]

class LoginScreen(Screen):
    pass

class DashboardScreen(Screen):
    pass

class StudentMgmtScreen(Screen):
    pass

class AttendanceScreen(Screen):
    pass

class ReportScreen(Screen):
    pass

class HostelBiometricApp(App):
    message = StringProperty('')

    def build(self):
        self.db = DBManager()
        self.title = 'Hostel Biometric Management'
        return Builder.load_file('hostel_biometric.kv')

    def on_start(self):
        self.refresh_dashboard()
        self.load_students()
        self.load_attendance_logs()

    def admin_login(self, username, password):
        if self.db.validate_admin(username.strip(), password.strip()):
            self.message = 'Admin logged in successfully.'
            self.refresh_dashboard()
            self.root.current = 'dashboard'
            self.clear_login_fields()
        else:
            self.message = 'Invalid admin credentials.'

    def clear_login_fields(self):
        screen = self.root.get_screen('login')
        screen.ids.admin_username.text = ''
        screen.ids.admin_password.text = ''

    def refresh_dashboard(self):
        students = len(self.db.get_students())
        logs = len(self.db.get_attendance_logs(1000))
        biometrics = len(self.db.list_biometrics())
        screen = self.root.get_screen('dashboard')
        screen.ids.total_students.text = str(students)
        screen.ids.total_logs.text = str(logs)
        screen.ids.total_biometrics.text = str(biometrics)

    def load_students(self):
        students = self.db.get_students()
        text = ''
        for student in students:
            text += f"{student['id']}: {student['name']} | {student['roll_no']} | Room {student['room_no']} | {student['phone']}\n"
        self.root.get_screen('student_mgmt').ids.student_list.text = text or 'No student records found.'

    def load_attendance_logs(self):
        logs = self.db.get_attendance_logs()
        text = ''
        for log in logs:
            text += f"{log['date']} {log['time']} - {log['name']} ({log['roll_no']}) → {log['status']}\n"
        self.root.get_screen('attendance').ids.attendance_list.text = text or 'No attendance records available.'

    def save_student(self, student_id, name, roll_no, room_no, phone):
        name = name.strip()
        roll_no = roll_no.strip()
        if not name or not roll_no:
            self.message = 'Name and Roll No are required.'
            return
        if student_id:
            self.db.update_student(int(student_id), name, roll_no, room_no.strip(), phone.strip())
            self.message = 'Student record updated.'
        else:
            success = self.db.add_student(name, roll_no, room_no.strip(), phone.strip())
            self.message = 'Student registered.' if success else 'Roll number already exists.'
        self.load_students()
        self.refresh_dashboard()

    def delete_student(self, student_id):
        if not student_id:
            self.message = 'Select a student record to delete.'
            return
        self.db.delete_student(int(student_id))
        self.message = 'Student record deleted.'
        self.load_students()
        self.refresh_dashboard()

    def enroll_biometric(self, roll_no, biometric_type):
        if not roll_no.strip() or biometric_type not in ('fingerprint', 'face'):
            self.message = 'Enter roll number and select a biometric type.'
            return
        student = self.db.get_student_by_roll(roll_no.strip())
        if not student:
            self.message = 'Student not found. Please register first.'
            return
        raw_template = self.simulate_mobile_biometric_scan(biometric_type)
        biometric_hash = self.hash_biometric(raw_template)
        if self.db.has_duplicate_biometric(biometric_hash, biometric_type):
            self.message = 'Duplicate biometric data detected. Enrollment rejected.'
            return
        self.db.store_biometric(student['id'], biometric_type, biometric_hash, raw_template)
        self.message = f'{biometric_type.title()} enrolled for {student["name"]}.'
        self.refresh_dashboard()

    def biometric_login(self, biometric_type):
        self.message = 'Starting biometric scan...'
        raw_template = self.simulate_mobile_biometric_scan(biometric_type)
        biometric_hash = self.hash_biometric(raw_template)
        match = self.db.match_biometric(biometric_hash, biometric_type)
        if match:
            status = self.calculate_attendance_status()
            self.db.add_attendance(match['student_id'], status)
            self.message = f'Welcome {match["name"]}! Attendance marked as {status}.'
            self.load_attendance_logs()
            self.refresh_dashboard()
            self.root.current = 'attendance'
        else:
            self.message = 'Biometric match failed. Student not recognized.'

    def hash_biometric(self, raw_template):
        return hashlib.sha256(raw_template.encode()).hexdigest()

    def simulate_mobile_biometric_scan(self, biometric_type):
        now = datetime.datetime.now().isoformat()
        return f'{biometric_type}-{now}-device-scan'

    def calculate_attendance_status(self):
        current_hour = datetime.datetime.now().hour
        return 'On time' if current_hour < LATE_HOUR else 'Late entry'

    def generate_report(self, period, date_text):
        period = period or 'daily'
        date_text = date_text.strip() or datetime.date.today().isoformat()
        report = self.db.get_report(period, date_text)
        text = f'{period.title()} report for {date_text}\n\n'
        if not report:
            text += 'No attendance records for selected period.'
        else:
            for item in report:
                text += f"{item['date']} {item['time']} - {item['name']} ({item['roll_no']}) → {item['status']}\n"
        self.root.get_screen('report').ids.report_body.text = text
        self.message = 'Report generated.'

    def send_alert(self, message):
        print(f'ALERT: {message}')
        # Optionally integrate SMS / email API here.

if __name__ == '__main__':
    HostelBiometricApp().run()
