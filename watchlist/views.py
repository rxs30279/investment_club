import requests
from django.shortcuts import render, redirect
from .models import Stock
from django.contrib import messages
from django.urls import reverse
from .forms import StockForm
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor

"""
WATCHLIST

1. The code starts by importing necessary modules and packages, including Django-related modules, the `Stock` model, `messages` from Django, `yfinance` for stock data retrieval, and `ThreadPoolExecutor` for parallel processing.

2. The code defines several helper functions:
   - `check_stock_ticker_existed(stock_ticker)`: Checks if a stock with the given ticker symbol already exists in the database.
   - `check_valid_stock_ticker(stock_ticker)`: Checks if the provided stock ticker symbol is valid by searching for the stock using `yfinance`.
   - `search_stock(stock_ticker)`: Searches for stock information using `yfinance` for the given stock ticker symbol.
   - `search_stock_batch(stock_tickers)`: Searches for multiple stocks in parallel using a `ThreadPoolExecutor` and the `search_stock` function.

3. The `Portfolio` function is the main view function that handles HTTP requests. If the request method is POST, it processes the form data to add a new stock to the portfolio.
   - It retrieves the stock ticker symbol from the POST data and converts it to uppercase.
   - It checks if the ticker symbol is valid and not already existing in the portfolio.
   - If the ticker symbol is valid and unique, it saves the form data (not the yfinance data) and adds the stock to the portfolio.
   - If there are any issues or errors, appropriate messages are displayed.

4. If the request method is not POST (page load), it retrieves the list of tickers from the database and then retrieves the stock data for those tickers using the `search_stock_batch` function.
   - If there are stocks in the database, it retrieves the tickers and calls `search_stock_batch` to get the stock data.
   - It then adds additional information (ticker, create date, name) from the database to each stock's dictionary.
   - If there are no stocks in the database, it displays a message indicating that the portfolio is empty.

5. Finally, the function renders the "watchlist.html" template with the stock data dictionary.

6. The `DeleteStock` function handles the deletion of a stock from the portfolio. It retrieves the stock object based on the provided stock symbol, deletes it from the database, and displays a success message. It then redirects the user back to the portfolio page.

Overall, the code handles adding and displaying stock data in the portfolio, checks for valid and unique stock ticker symbols, retrieves stock data using `yfinance`, and provides user feedback through messages.

"""     


def Portfolio(request):
    if request.method == "POST":
        ticker = request.POST["ticker"]
        ticker = ticker.upper()
        if ticker:
            form = StockForm(request.POST or None)
            if form.is_valid():
                if check_stock_ticker_existed(ticker):
                    messages.warning(
                        request, f"{ticker} already exists in the Portfolio."
                    )
                    return redirect("watchlist")

                if check_valid_stock_ticker(ticker):
                    # add stock to the database if it exists, otherwise return error message
                    # This data is from the form - EPIC ID and Name. The data from yfinance is not saved.
                    # The 'return redirect' returns to the user to the 'watchlist' page, there the data is refreshed including the new database entry.
                    form.save()
                    messages.success(request, f"{ticker} has been added successfully.")
                    return redirect("watchlist")

        messages.warning(request, "Please enter a valid ticker name.  Make sure '*****.L' is appended for London based stocks.")
        return redirect("watchlist")
    else:
        # Retrieve tickers from the database when the page loads and there is no POST event
        stockdata = Stock.objects.all()
        if stockdata:
            tickers = [stock.ticker for stock in stockdata]

            # retrieve the ticker(stock)information from the batch function using yfinance
            stockdata = search_stock_batch(tickers)

            # add database information, the 'name' to each element of the dictionary of dictionaries.

            i = 0
            for d in stockdata:
                my_model = Stock.objects.get(ticker=tickers[i])
                d["ticker"] = my_model.ticker
                d["create_date"] = my_model.create_date
                d["name"] = my_model.name
                i += 1
            # # Read selected yfinance output to the database

        else:
            messages.info(request, "Currently, there are no stocks in your portfolio!")
        # Render the stock_data.html template with the stock data dictionary
        return render(request, "watchlist.html", {"all_tickers": stockdata})

                ############ Functions ############

def DeleteStock(request, stock_symbol):
    stock = Stock.objects.get(ticker=stock_symbol)
    stock.delete()
    messages.success(request, f"{stock.ticker} has been deleted successfully.")
    return redirect("watchlist")


def check_stock_ticker_existed(stock_ticker):
    """
    Checks if a stock with the given ticker symbol already exists in the database.
    Returns True if it exists, False otherwise.
    """
    try:
        stock = Stock.objects.get(ticker=stock_ticker)
        if stock:
            return True
    except Exception:
        return False


def check_valid_stock_ticker(stock_ticker):
    """
    Checks if the provided stock ticker symbol is valid by searching for the stock using yfinance.
    Returns True if the stock is valid, False otherwise.
    Calls the search_stock function to pull data from yfinance using the EPIC company ID 'stock_ticker'
    """
    print(stock_ticker)
    stock = search_stock(stock_ticker)
    if "Error" not in stock:
        return True
    return False


def search_stock(stock_ticker):
    """
    Searches for stock information using yfinance for the given stock ticker symbol.
    Returns the stock data if found, or an error message if there was an issue.
    """
    try:
        data = yf.Ticker(stock_ticker).info
        if data["symbol"] == stock_ticker:
            return data
        else:
            data = {
                "Error": "There was a problem with your provided ticker symbol. Please try again"
            }
    except Exception as e:
        data = {
            "Error": "There has been some connection error. Please try again later."
        }
    return data


def search_stock_batch(stock_tickers):
    """
    Searches for multiple stocks in parallel using a ThreadPoolExecutor and the search_stock function.
    Returns a list of stock data for each stock ticker symbol.
    """
    results = {}
    with ThreadPoolExecutor() as executor:
        results = list(executor.map(search_stock, stock_tickers))
    return results

