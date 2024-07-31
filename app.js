const express = require('express');
const mysql = require('mysql2');
const app = express();

const bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({ extended: true }));

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'courtbookingapp'
});

connection.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
        return;
    }
    console.log('Connected to MySQL database');
});

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({
    extended: false
}));

app.get('/', (req, res) => {
    const { SearchDate } = req.query;

    let sql = `
        SELECT * 
        FROM court AS C 
        JOIN court_has_slots AS CS 
        ON C.court_id = CS.court_id 
        AND CS.available = "yes"
        ORDER BY CS.date, CS.start_time;
    `;

    const updateSql = `
        UPDATE court_has_slots SET available = 'no' WHERE date <= DATE(NOW());
    `;

    // Update booking statuses first
    connection.query(updateSql, updateError => {
        if (updateError) {
            console.error('Database update error:', updateError.message);
            return res.status(500).send('Error updating booking statuses');
        }

        // If SearchDate is provided, modify the SQL query to filter by date
        if (SearchDate) {
            sql += ' WHERE CS.date = ?';  // Use placeholders for query parameters to prevent SQL injection
        }

        // Execute the main query after the update query
        connection.query(sql, [SearchDate].filter(Boolean), (error, results) => {
            if (error) {
                console.error('Database query error:', error.message);
                return res.status(500).send('Error retrieving slots');
            }

            // Format date for each result
            results.forEach(slot => {
                slot.formatted_date = new Date(slot.date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: '2-digit'
                });
            });

            res.render('index', { slots: results });
        });
    });
});



app.get('/location', (req, res) => {
    const sql = 'SELECT DISTINCT location, image FROM court';

    connection.query(sql, (error, results) => {
        if (error) {
            console.error('Database query error:', error.message);
            return res.status(500).send('Error Retrieving locations');
        }

        res.render('location', { locations: results });
    });
});

app.get('/location/:location_name', (req, res) => {
    const { location_name } = req.params;  // Extract location_name from URL parameters

    // Base SQL query
    let sql = 'SELECT * FROM court AS C JOIN court_has_slots AS CS ON C.court_id = CS.court_id AND CS.available = "yes" WHERE C.location = ?';

    connection.query(sql, [location_name], (error, results) => {
        if (error) {
            console.error('Database query error:', error.message);
            return res.status(500).send('Error Retrieving Slots');
        }

        // Format date for each result
        results.forEach(slot => {
            slot.formatted_date = new Date(slot.date).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: '2-digit'
            });
        });

        res.render('location_details', { slots: results });
    });
});

app.get('/location/:location_name/:id', (req, res) => {
    const { location_name, id: slot_id } = req.params; // Correctly destructuring location_name and id
    const sql = 'SELECT * FROM court AS C JOIN court_has_slots AS CS ON C.court_id = CS.court_id WHERE CS.slot_id = ?';

    connection.query(sql, [slot_id], (error, results) => { // Pass court_id to query
        if (error) {
            console.error('Database query error:', error.message);
            return res.status(500).send('Error Retrieving slot by ID');
        }

        if (results.length > 0) {
            results.forEach(slot => {
                slot.formatted_date = new Date(slot.date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: '2-digit'
                });
            });

            // Render HTML page with the given ID found
            res.render('slot', { slots: results });
        } else {
            res.status(404).send('Slot not found');
        }
    });
});


app.get('/authentication', (req, res) => {
    res.render('authentication');
});

app.get('/register', (req, res) => {
    res.render('register');
});

app.post('/register', (req, res) => {
    const { first_name, last_name, contact, birthday, gender, password } = req.body;

    // is NaN function is provided by ChatGPT
    if (contact.length !== 8 || isNaN(contact)) {
        return res.send('<script>alert("Contact Must be an 8-digit number"); window.location="/register";</script>');
    }

    const sql = 'INSERT INTO user (first_name, last_name, contact, birthday, gender, password) VALUES (?, ?, ?, ?, ?, ?)';

    connection.query(sql, [first_name, last_name, contact, birthday, gender, password], (error, results) => {
        if (error) {
            console.error("Error adding user:", error); 
            res.status(500).send('Error adding user');
        } else {
            res.redirect('/authentication');
        }
    });
});


app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', (req, res) => {
    const { contact, password } = req.body;  // Use req.body for POST requests

    let sql = 'SELECT * FROM user WHERE contact = ? AND password = ?';

    connection.query(sql, [contact, password], (error, results) => {
        if (error) {
            console.error('Database query error:', error);
            return res.status(500).send('Error during login');
        }

        if (results.length > 0) {
            // User found, password matched
            // Set session or cookie here if required
            res.redirect(`/user/${results[0].user_id}`);  // Redirect to the home page or dashboard
        } else {
            // User not found or password didn't match
            return res.send('<script>alert("Invalid contact or password or user not found (please proceed to register an account)"); window.location="/login";</script>');
        }
    });
});



app.get('/user/:id', (req, res) => {
    const userId = req.params.id;

    const userSql = 'SELECT * FROM user WHERE user_id = ?';
    
    const bookingSql = `
    SELECT U.user_id, C.location, CS.slot_id, CS.date, CS.start_time, CS.end_time, B.booking_status 
    FROM user AS U 
    JOIN booking AS B ON U.user_id = B.user_id 
    JOIN court_has_slots AS CS ON B.slot_id = CS.slot_id
    JOIN court AS C ON CS.court_id = C.court_id
    WHERE U.user_id = ?
    ORDER BY CS.date DESC;`;

    const updateSql = `
        UPDATE booking AS B
        JOIN court_has_slots AS CS ON B.slot_id = CS.slot_id
        SET B.booking_status = 'completed'
        WHERE CS.date < DATE(NOW());
    `;

    // Execute the update query first
    connection.query(updateSql, updateError => {
        if (updateError) {
            console.error('Database update error:', updateError.message);
            return res.status(500).send('Error updating booking statuses');
        }

        // Then fetch the user details
        connection.query(userSql, [userId], (userError, userResults) => {
            if (userError) {
                console.error('Database query error:', userError.message);
                return res.status(500).send('Error retrieving user by ID');
            }

            // format to change the date into a more readable format is provided by chatgpt
            if (userResults.length > 0) {
                // Format user's birthday date
                userResults[0].formatted_birthday = new Date(userResults[0].birthday).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: '2-digit'
                });

                // Fetch user's bookings
                connection.query(bookingSql, [userId], (bookingError, bookingResults) => {
                    if (bookingError) {
                        console.error('Database query error:', bookingError.message);
                        return res.status(500).send('Error retrieving bookings');
                    }

                    // Format booking dates
                    bookingResults.forEach(booking => {
                        booking.formatted_date = new Date(booking.date).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: '2-digit'
                        });
                    });

                    // Render the user profile page with user's info and bookings
                    res.render('user', { user: userResults[0], bookings: bookingResults });
                });
            } else {
                res.status(404).send('User not found');
            }
        });
    });
});


app.get('/user/:user_id/:slot_id/release', (req, res) => {
    const user_id = req.params.user_id;
    const slot_id = req.params.slot_id;

    const sql1 = 'UPDATE court_has_slots SET available = "yes" WHERE slot_id = ?;';
    const sql2 = 'UPDATE booking SET booking_status = "cancelled" WHERE slot_id = ?;';

    connection.query(sql1, [slot_id], (error, results) => {
        if (error) {
            console.error('Error updating court slot status:', error.message);
            return res.status(500).send('Error updating court slot status');
        }

        connection.query(sql2, [slot_id], (error, results) => {
            if (error) {
                console.error('Error updating booking status:', error.message);
                return res.status(500).send('Error updating booking status');
            }

            res.redirect('/');
        });
    });
});


app.get('/user/:id/edit', (req, res) => {
    const user_id = req.params.id;

    const sql = 'SELECT * FROM user WHERE user_id = ?';

    connection.query(sql, [user_id], (error, results) => {
        if (error) {
            console.error('Database query error:', error.message);
            return res.status(500).send('Error Retrieving user by ID');
        }

        if (results.length > 0) {
            res.render('edituser', { user: results[0] });
        } else {
            res.status(404).send('User not found');
        }
    });
});

app.post('/user/:user_id/edit', (req, res) => {
    const user_id = req.params.user_id;
    const { first_name, last_name, contact, birthday, gender, old_password, new_password } = req.body;

    console.log('Received data:', { first_name, last_name, contact, birthday, gender, old_password, new_password });

    const getPasswordQuery = 'SELECT password FROM user WHERE user_id = ?';
    connection.query(getPasswordQuery, [user_id], (error, results) => {
        if (error) {
            console.error('Database query error:', error);
            return res.status(500).send('Error retrieving user details');
        }

        if (results.length === 0) {
            return res.status(404).send('User not found');
        }

        const storedPassword = results[0].password;

        // Debugging: Check if old_password and storedPassword are defined
        console.log('Old Password:', old_password);
        console.log('Stored Password:', storedPassword);

        // Compare the plain text old password with the stored password
        if (old_password !== storedPassword) {
            return res.send('<script>alert("Incorrect old password"); window.location="/login";</script>');
        }

        // Update user details
        const updateUserQuery = 'UPDATE user SET first_name = ?, last_name = ?, contact = ?, birthday = ?, gender = ?, password = ? WHERE user_id = ?';
        connection.query(updateUserQuery, [first_name, last_name, contact, birthday, gender, new_password, user_id], (error, updateResults) => {
            if (error) {
                console.error('Database query error:', error);
                return res.status(500).send('Error updating user details');
            }

            res.redirect(`/user/${user_id}`);
        });
    });
});


// Route to render the booking form
app.get('/location/:location_name/:id/book', (req, res) => {
    const { location_name, id: slot_id } = req.params;
    console.log('Booking form request:', { location_name, slot_id });

    const sql = 'SELECT * FROM court AS C JOIN court_has_slots AS CS ON C.court_id = CS.court_id WHERE CS.slot_id = ?';

    connection.query(sql, [slot_id], (error, results) => {
        if (error) {
            console.error('Database query error:', error.message);
            return res.status(500).send('Error Retrieving slot by ID');
        }

        if (results.length > 0) {
            results.forEach(slot => {
                slot.formatted_date = new Date(slot.date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: '2-digit'
                });
            });

            console.log('Slot found:', results);
            res.render('book', { slots: results });
        } else {
            console.log('Slot not found:', slot_id);
            res.status(404).send('Slot not found');
        }
    });
});

// POST endpoint for handling login and booking
// Route to render the booking form
app.get('/location/:location_name/:id/book', (req, res) => {
    const { location_name, id: slot_id } = req.params;
    console.log('Booking form request:', { location_name, slot_id });

    const sql = 'SELECT * FROM court AS C JOIN court_has_slots AS CS ON C.court_id = CS.court_id WHERE CS.slot_id = ?';

    connection.query(sql, [slot_id], (error, results) => {
        if (error) {
            console.error('Database query error:', error.message);
            return res.status(500).send('Error Retrieving slot by ID');
        }

        if (results.length > 0) {
            results.forEach(slot => {
                slot.formatted_date = new Date(slot.date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: '2-digit'
                });
            });

            console.log('Slot found:', results);
            res.render('book', { slots: results });
        } else {
            console.log('Slot not found:', slot_id);
            res.status(404).send('Slot not found');
        }
    });
});

// POST endpoint for handling login and booking
app.post('/location/:location_name/:id/book', (req, res) => {
    const { contact, password } = req.body;
    const { location_name, id: slot_id } = req.params;
    console.log('Login and booking request:', { contact, password, location_name, slot_id });

    const sql = 'SELECT * FROM user WHERE contact = ? AND password = ?';
    const sql2 = 'INSERT INTO booking (user_id, slot_id, booking_status) VALUES (?, ?, "booked")';
    const sql3 = 'UPDATE court_has_slots SET available = "no" WHERE slot_id = ?';

    connection.query(sql, [contact, password], (error, results) => {
        if (error) {
            console.error('Database query error:', error);
            return res.status(500).send('Error during login');
        }

        if (results.length > 0) {
            // User found, password matched
            const user_id = results[0].user_id; // Assuming the user_id is obtained here

            // Ensure slot_id exists in court_has_slots
            const checkSlotSql = 'SELECT * FROM court_has_slots WHERE slot_id = ?';
            connection.query(checkSlotSql, [slot_id], (error, slotResults) => {
                if (error) {
                    console.error('Database query error:', error);
                    return res.status(500).send('Error during booking');
                }

                if (slotResults.length > 0) {
                    // Insert booking record
                    connection.query(sql2, [user_id, slot_id], (error, bookingResults) => {
                        if (error) {
                            console.error('Database query error:', error);
                            return res.status(500).send('Error during booking');
                        }

                        // Update slot availability
                        connection.query(sql3, [slot_id], (error, updateResults) => {
                            if (error) {
                                console.error('Database query error:', error);
                                return res.status(500).send('Error during booking');
                            }

                            // Redirect to the home page with an alert
                            res.send(`
                                <html>
                                    <body>
                                        <script>
                                            alert('Booking completed successfully.');
                                            window.location.href = '/';
                                        </script>
                                    </body>
                                </html>
                            `);
                        });
                    });
                } else {
                    res.status(400).send('Invalid slot ID');
                }
            });
        } else {
            // User not found or password didn't match
            console.log('Invalid contact or password:', { contact, password });
            return res.send('<script>alert("Invalid contact or password or user not found (please proceed to register an account)"); window.location="/";</script>');
        }
    });
});


app.get('/about', (req, res) => {
    res.render('about');
  });
  
  // Route to handle feedback submission
app.post('/submit-feedback', (req, res) => {
    const { feedback } = req.body;
  
    // Insert the feedback into the database
    // used of bracket for feedback and ? is provided by chatgpt
    const sql = 'INSERT INTO feedback (feedback) VALUES (?)';
    connection.query(sql, [feedback], (error, results) => {
      if (error) {
        console.error('Error inserting feedback:', error);
        return res.status(500).send('Error submitting feedback');
      }
  
      res.send('<script>alert("Feedback submitted successfully"); window.location="/about";</script>');
    });
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));