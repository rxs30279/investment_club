from django.shortcuts import render
from .models import SharesModel
import pandas as pd
# from plotly.offline import plot
# import plotly.express as px
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor

# Create your views here.


def Competition(request):
    print("sorted")
    # Extract relevant information from the queryset and create a list of dictionaries in 'holdings_data'
    qs = SharesModel.objects.all()
    holdings_data = [
        {
            "Starting Price": x.purchase_price,
            "Holdings": x.shares,
            "EPIC": x.epic,
        }
        for x in qs
    ]
    # Dataframe creation and calculations
    df = pd.DataFrame(holdings_data)
    print(df)
  # Fetch the stock price from yahoo finance
    try:
        yahoo = search_stock_batch(df["EPIC"])
    
    except Exception as e:
        data = {
            "Error": "There has been some error. Please try again later."
        }

    return render(request, "competition.html")  

        
        
############## Functions ########################

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



