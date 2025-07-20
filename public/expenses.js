let expenses = JSON.parse(localStorage.getItem('expenses')) || [];

        // Initialize the app
        document.addEventListener('DOMContentLoaded', async function() {
            // Check authentication status
            try {
                const authCheck = await fetch('/api/auth-check', {
                    credentials: 'include'
                });
                if (!authCheck.ok) {
                    window.location.href = '/login';
                    return;
                }
            } catch (error) {
                console.error('Auth check failed:', error);
                window.location.href = '/login';
                return;
            }
            
            renderExpenses();
            updateTotals();
            
            // Set today's date as default
            document.getElementById('date').valueAsDate = new Date();
        });

        // City search functionality
        let citySearchTimeout;
        document.getElementById('city').addEventListener('input', function() {
            const query = this.value.trim();
            const state = document.getElementById('state').value.trim();
            
            clearTimeout(citySearchTimeout);
            
            if (query.length >= 2) {
                citySearchTimeout = setTimeout(() => {
                    searchCities(query, state);
                }, 300);
            } else {
                hideCitySuggestions();
            }
        });

        async function searchCities(query, state) {
            try {
                const response = await fetch(`/api/search-cities?query=${encodeURIComponent(query)}&state=${encodeURIComponent(state)}`, {
                    credentials: 'include'
                });
                
                // Check if response is actually JSON
                const contentType = response.headers.get('content-type');
                if (!contentType || !contentType.includes('application/json')) {
                    console.error('Server returned non-JSON response, possibly authentication issue');
                    hideCitySuggestions();
                    return;
                }
                
                if (!response.ok) {
                    if (response.status === 401 || response.status === 403) {
                        // Authentication issue - redirect to login
                        window.location.href = '/login';
                        return;
                    }
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const data = await response.json();
                showCitySuggestions(data.cities || []);
            } catch (error) {
                console.error('City search error:', error);
                hideCitySuggestions();
            }
        }

        function showCitySuggestions(cities) {
            const dropdown = document.getElementById('citySuggestions');
            dropdown.innerHTML = '';
            
            if (cities.length === 0) {
                hideCitySuggestions();
                return;
            }
            
            cities.forEach(city => {
                const item = document.createElement('div');
                item.className = 'suggestion-item';
                
                // Create detailed display
                const mainText = `${city.city}, ${city.state}`;
                const subText = city.zipCode ? `ZIP: ${city.zipCode}` : 'No ZIP found';
                const countyText = city.county ? ` • ${city.county}` : '';
                
                item.innerHTML = `
                    <div style="font-weight: 500;">${mainText}</div>
                    <div style="font-size: 0.8rem; color: #666;">${subText}${countyText}</div>
                `;
                
                item.onclick = () => {
                    document.getElementById('city').value = city.city;
                    document.getElementById('state').value = city.state;
                    if (city.zipCode) {
                        document.getElementById('zipCode').value = city.zipCode;
                    }
                    hideCitySuggestions();
                };
                dropdown.appendChild(item);
            });
            
            dropdown.style.display = 'block';
        }

        function hideCitySuggestions() {
            document.getElementById('citySuggestions').style.display = 'none';
        }

        // Close suggestions when clicking outside
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.city-suggestions')) {
                hideCitySuggestions();
            }
        });

        async function getPerDiem() {
            const city = document.getElementById('city').value.trim();
            const state = document.getElementById('state').value.trim().toUpperCase();
            const date = document.getElementById('date').value;
            const zipCode = document.getElementById('zipCode').value.trim();
            
            if (!city || !state || !date) {
                showError('Please enter city, state, and date');
                return;
            }
            
            if (state.length !== 2) {
                showError('Please enter a valid 2-letter state code');
                return;
            }
            
            showLoading(true);
            hideMessages();
            
            try {
                const requestBody = { city, state, date };
                if (zipCode && /^\d{5}$/.test(zipCode)) {
                    requestBody.zipCode = zipCode;
                }
                
                const response = await fetch('/api/perdiem', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody),
                    credentials: 'include'
                });
                
                // Check if response is actually JSON
                const contentType = response.headers.get('content-type');
                if (!contentType || !contentType.includes('application/json')) {
                    if (response.status === 401 || response.status === 403) {
                        window.location.href = '/login';
                        return;
                    }
                    throw new Error('Server returned non-JSON response');
                }
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const data = await response.json();
                
                if (data.success) {
                    const expenseType = document.getElementById('expenseType').value;
                    let perDiemAmount = 0;
                    
                    if (expenseType === 'lodging') {
                        perDiemAmount = data.data.lodging;
                    } else if (expenseType === 'food') {
                        perDiemAmount = data.data.meals + data.data.incidentals;
                    }
                    
                    document.getElementById('perDiemAmount').value = perDiemAmount.toFixed(2);
                    
                    // Show detailed success message
                    let methodText = data.method === 'zipcode' ? `using ZIP code ${data.zipCode}` : 'using city name lookup';
                    let locationText = data.data.county ? `${data.data.city}, ${data.data.county} County, ${data.data.state}` : `${data.data.city}, ${data.data.state}`;
                    
                    showSuccess(`Per diem rate found for ${locationText} (${methodText}): Lodging: $${data.data.lodging}, Meals & Incidentals: $${data.data.meals + data.data.incidentals}`);
                } else {
                    showError(data.error || 'Failed to get per diem rate');
                }
            } catch (error) {
                showError('Failed to fetch per diem rate. Please try again.');
                console.error('Error:', error);
            } finally {
                showLoading(false);
            }
        }

        document.getElementById('expenseForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            // Get form values
            const expenseType = document.getElementById('expenseType').value;
            const city = document.getElementById('city').value.trim();
            const state = document.getElementById('state').value.trim().toUpperCase();
            const date = document.getElementById('date').value;
            const zipCode = document.getElementById('zipCode').value.trim();
            const receiptAmount = parseFloat(document.getElementById('receiptAmount').value);
            
            // Validate required fields
            if (!expenseType || !city || !state || !date || !receiptAmount) {
                showError('Please fill in all required fields');
                return;
            }
            
            if (state.length !== 2) {
                showError('Please enter a valid 2-letter state code');
                return;
            }
            
            showLoading(true);
            hideMessages();
            
            try {
                // Automatically get per diem rate
                let perDiemAmount = 0;
                
                const requestBody = { city, state, date };
                if (zipCode && /^\d{5}$/.test(zipCode)) {
                    requestBody.zipCode = zipCode;
                }
                
                const response = await fetch('/api/perdiem', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody),
                    credentials: 'include'
                });
                
                // Check if response is actually JSON
                const contentType = response.headers.get('content-type');
                if (!contentType || !contentType.includes('application/json')) {
                    if (response.status === 401 || response.status === 403) {
                        window.location.href = '/login';
                        return;
                    }
                    throw new Error('Server returned non-JSON response');
                }
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const data = await response.json();
                
                if (data.success) {
                    if (expenseType === 'lodging') {
                        perDiemAmount = data.data.lodging;
                    } else if (expenseType === 'food') {
                        perDiemAmount = data.data.meals + data.data.incidentals;
                    }
                    
                    // Update the per diem field to show the retrieved value
                    document.getElementById('perDiemAmount').value = perDiemAmount.toFixed(2);
                } else {
                    // If per diem lookup fails, continue with 0 but show warning
                    console.warn('Per diem lookup failed:', data.error);
                    showError('Warning: Could not retrieve per diem rate. Expense added with $0 per diem.');
                }
                
                // Create and add the expense
                const expense = {
                    id: Date.now(),
                    type: expenseType,
                    date: date,
                    establishment: document.getElementById('establishment').value,
                    receiptAmount: receiptAmount,
                    perDiemAmount: perDiemAmount,
                    reimbursableAmount: perDiemAmount > 0 ? Math.min(receiptAmount, perDiemAmount) : receiptAmount, // Use receipt amount if no per diem available
                    city: city,
                    state: state,
                    zipCode: zipCode,
                    note: document.getElementById('note').value
                };
                
                expenses.push(expense);
                saveExpenses();
                renderExpenses();
                updateTotals();
                
                // Reset form
                document.getElementById('expenseForm').reset();
                document.getElementById('perDiemAmount').value = '';
                document.getElementById('zipCode').value = '';
                document.getElementById('date').valueAsDate = new Date();
                
                showSuccess('Expense added successfully with per diem rate!');
                
            } catch (error) {
                console.error('Error adding expense:', error);
                showError('Failed to add expense. Please try again.');
            } finally {
                showLoading(false);
            }
        });

        function renderExpenses() {
            const tbody = document.getElementById('expenseTableBody');
            tbody.innerHTML = '';
            
            // Group expenses by type
            const lodgingExpenses = expenses.filter(e => e.type === 'lodging');
            const foodExpenses = expenses.filter(e => e.type === 'food');
            
            // Render lodging expenses
            if (lodgingExpenses.length > 0) {
                const lodgingHeader = document.createElement('tr');
                lodgingHeader.innerHTML = '<td colspan="9" style="background: #e9ecef; font-weight: bold; text-align: center;">LODGING</td>';
                tbody.appendChild(lodgingHeader);
                
                lodgingExpenses.forEach(expense => {
                    const row = createExpenseRow(expense);
                    tbody.appendChild(row);
                });
            }
            
            // Render food expenses
            if (foodExpenses.length > 0) {
                const foodHeader = document.createElement('tr');
                foodHeader.innerHTML = '<td colspan="9" style="background: #e9ecef; font-weight: bold; text-align: center;">FOOD</td>';
                tbody.appendChild(foodHeader);
                
                foodExpenses.forEach(expense => {
                    const row = createExpenseRow(expense);
                    tbody.appendChild(row);
                });
            }
            
            // Add totals row
            if (expenses.length > 0) {
                const totalsRow = document.createElement('tr');
                totalsRow.className = 'total-row';
                const lodgingTotal = lodgingExpenses.reduce((sum, e) => {
                    const reimbursableAmount = e.reimbursableAmount || (e.perDiemAmount > 0 ? Math.min(e.receiptAmount, e.perDiemAmount) : e.receiptAmount);
                    return sum + reimbursableAmount;
                }, 0);
                const foodTotal = foodExpenses.reduce((sum, e) => {
                    const reimbursableAmount = e.reimbursableAmount || (e.perDiemAmount > 0 ? Math.min(e.receiptAmount, e.perDiemAmount) : e.receiptAmount);
                    return sum + reimbursableAmount;
                }, 0);
                const grandTotal = lodgingTotal + foodTotal;
                const receiptTotal = expenses.reduce((sum, e) => sum + e.receiptAmount, 0);
                
                totalsRow.innerHTML = `
                    <td colspan="3"><strong>TOTALS:</strong></td>
                    <td class="amount"><strong>$${receiptTotal.toFixed(2)}</strong></td>
                    <td class="amount"><strong>$${expenses.reduce((sum, e) => sum + e.perDiemAmount, 0).toFixed(2)}</strong></td>
                    <td class="amount"><strong>$${grandTotal.toFixed(2)}</strong></td>
                    <td colspan="3"></td>
                `;
                tbody.appendChild(totalsRow);
            }
        }

        function createExpenseRow(expense) {
            const row = document.createElement('tr');
            const formattedDate = new Date(expense.date).toLocaleDateString();
            const reimbursableAmount = expense.reimbursableAmount || (expense.perDiemAmount > 0 ? Math.min(expense.receiptAmount, expense.perDiemAmount) : expense.receiptAmount);
            
            row.innerHTML = `
                <td>${expense.type.charAt(0).toUpperCase() + expense.type.slice(1)}</td>
                <td>${formattedDate}</td>
                <td>${expense.establishment}</td>
                <td class="amount">$${expense.receiptAmount.toFixed(2)}</td>
                <td class="amount">$${expense.perDiemAmount.toFixed(2)}</td>
                <td class="amount">$${reimbursableAmount.toFixed(2)}</td>
                <td>${expense.city}, ${expense.state}${expense.zipCode ? ` (${expense.zipCode})` : ''}</td>
                <td>${expense.note || '-'}</td>
                <td>
                    <button class="btn btn-danger" onclick="deleteExpense(${expense.id})" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;">Delete</button>
                </td>
            `;
            
            return row;
        }

        function deleteExpense(id) {
            if (confirm('Are you sure you want to delete this expense?')) {
                expenses = expenses.filter(e => e.id !== id);
                saveExpenses();
                renderExpenses();
                updateTotals();
                showSuccess('Expense deleted successfully!');
            }
        }

        function updateTotals() {
            const lodgingTotal = expenses
                .filter(e => e.type === 'lodging')
                .reduce((sum, e) => {
                    const reimbursableAmount = e.reimbursableAmount || (e.perDiemAmount > 0 ? Math.min(e.receiptAmount, e.perDiemAmount) : e.receiptAmount);
                    return sum + reimbursableAmount;
                }, 0);
            
            const foodTotal = expenses
                .filter(e => e.type === 'food')
                .reduce((sum, e) => {
                    const reimbursableAmount = e.reimbursableAmount || (e.perDiemAmount > 0 ? Math.min(e.receiptAmount, e.perDiemAmount) : e.receiptAmount);
                    return sum + reimbursableAmount;
                }, 0);
            
            const grandTotal = lodgingTotal + foodTotal;
            
            document.getElementById('lodgingTotal').textContent = `$${lodgingTotal.toFixed(2)}`;
            document.getElementById('foodTotal').textContent = `$${foodTotal.toFixed(2)}`;
            document.getElementById('grandTotal').textContent = `$${grandTotal.toFixed(2)}`;
        }

        function saveExpenses() {
            localStorage.setItem('expenses', JSON.stringify(expenses));
        }

        function clearAll() {
            if (confirm('Are you sure you want to clear all expenses? This cannot be undone.')) {
                expenses = [];
                saveExpenses();
                renderExpenses();
                updateTotals();
                showSuccess('All expenses cleared!');
            }
        }

        function exportData() {
            if (expenses.length === 0) {
                showError('No expenses to export');
                return;
            }
            
            let csv = 'Type,Date,Establishment,Receipt Amount,Per Diem Amount,Reimbursable Amount,City,State,Zip Code,Note\n';
            
            expenses.forEach(expense => {
                const formattedDate = new Date(expense.date).toLocaleDateString();
                const reimbursableAmount = expense.reimbursableAmount || (expense.perDiemAmount > 0 ? Math.min(expense.receiptAmount, expense.perDiemAmount) : expense.receiptAmount);
                csv += `"${expense.type}","${formattedDate}","${expense.establishment}","${expense.receiptAmount.toFixed(2)}","${expense.perDiemAmount.toFixed(2)}","${reimbursableAmount.toFixed(2)}","${expense.city}","${expense.state}","${expense.zipCode || ''}","${expense.note || ''}"\n`;
            });
            
            // Add totals
            const lodgingTotal = expenses.filter(e => e.type === 'lodging').reduce((sum, e) => {
                const reimbursableAmount = e.reimbursableAmount || (e.perDiemAmount > 0 ? Math.min(e.receiptAmount, e.perDiemAmount) : e.receiptAmount);
                return sum + reimbursableAmount;
            }, 0);
            const foodTotal = expenses.filter(e => e.type === 'food').reduce((sum, e) => {
                const reimbursableAmount = e.reimbursableAmount || (e.perDiemAmount > 0 ? Math.min(e.receiptAmount, e.perDiemAmount) : e.receiptAmount);
                return sum + reimbursableAmount;
            }, 0);
            const receiptTotal = expenses.reduce((sum, e) => sum + e.receiptAmount, 0);
            const perDiemTotal = expenses.reduce((sum, e) => sum + e.perDiemAmount, 0);
            const reimbursableTotal = lodgingTotal + foodTotal;
            
            csv += `\n"TOTALS","","","${receiptTotal.toFixed(2)}","${perDiemTotal.toFixed(2)}","${reimbursableTotal.toFixed(2)}","","","",""\n`;
            csv += `"Lodging Total","","","","","${lodgingTotal.toFixed(2)}","","","",""\n`;
            csv += `"Food Total","","","","","${foodTotal.toFixed(2)}","","","",""\n`;
            
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `per-diem-expenses-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            showSuccess('Data exported to CSV!');
        }

        function showLoading(show) {
            document.getElementById('loading').style.display = show ? 'block' : 'none';
        }

        function showError(message) {
            const errorEl = document.getElementById('error');
            errorEl.textContent = message;
            errorEl.style.display = 'block';
            setTimeout(() => errorEl.style.display = 'none', 5000);
        }

        function showSuccess(message) {
            const successEl = document.getElementById('success');
            successEl.textContent = message;
            successEl.style.display = 'block';
            setTimeout(() => successEl.style.display = 'none', 3000);
        }

        function hideMessages() {
            document.getElementById('error').style.display = 'none';
            document.getElementById('success').style.display = 'none';
        }

        async function logout() {
            try {
                await fetch('/logout', { 
                    method: 'POST',
                    credentials: 'include' 
                });
                window.location.href = '/login';
            } catch (error) {
                console.error('Logout error:', error);
                window.location.href = '/login';
            }
        }