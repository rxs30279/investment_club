import requests
from django.shortcuts import render, redirect
from .models import Stock
from django.contrib import messages

# from datetime import datetime
from django.urls import reverse

# from django.http import HttpResponse, HttpResponseRedirect
# from django.template import loader
from .forms import StockForm
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor

# from django.views.generic import ListView


def check_stock_ticker_existed(stock_ticker):
    try:
        stock = Stock.objects.get(ticker=stock_ticker)
        if stock:
            return True
    except Exception:
        return False


def check_valid_stock_ticker(stock_ticker):
    stock = search_stock(stock_ticker)
    if "Error" not in stock:
        return True
    return False


def search_stock(stock_ticker):
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
    results = {}
    with ThreadPoolExecutor() as executor:
        results = list(executor.map(search_stock, stock_tickers))
    return results


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
                    return redirect("portfolio")

                if check_valid_stock_ticker(ticker):
                    # add stock
                    form.save()
                    messages.success(request, f"{ticker} has been added successfully.")
                    return redirect("portfolio")

        messages.warning(request, "Please enter a valid ticker name.")
        return redirect("portfolio")
    else:
        # Retrieve tickers from the database
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
        return render(request, "portfolio.html", {"all_tickers": stockdata})


def DeleteStock(request, stock_symbol):
    stock = Stock.objects.get(ticker=stock_symbol)
    stock.delete()
    messages.success(request, f"{stock.ticker} has been deleted successfully.")
    return redirect("portfolio")
